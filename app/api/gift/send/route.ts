import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';
import { sendPushToUser } from '@/lib/push';
import { getAddedBalance } from '@/lib/gift-balance';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuthUser(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const body = await request.json();
    const { recipientId, amount, message, sourceBalance } = body;

    if (!recipientId || !amount || !sourceBalance) {
      return NextResponse.json(
        { error: 'Recipient ID, amount, and source balance are required' },
        { status: 400 }
      );
    }

    const senderId = authResult.user.id;

    const giftAmount = Number(amount);
    if (!Number.isFinite(giftAmount) || giftAmount <= 0) {
      return NextResponse.json(
        { error: 'Gift amount must be a positive number' },
        { status: 400 }
      );
    }
    const normalizedSource = String(sourceBalance).toLowerCase();
    if (!['withdrawable', 'added'].includes(normalizedSource)) {
      return NextResponse.json(
        { error: 'Invalid source balance' },
        { status: 400 }
      );
    }

    // Check if sender and recipient are different
    if (senderId === recipientId) {
      return NextResponse.json(
        { error: 'Cannot send gift to yourself' },
        { status: 400 }
      );
    }

    // Use transaction to ensure atomicity
    const result = await prisma.$transaction(async (tx) => {
      const sender = await tx.user.findUnique({
        where: { id: senderId },
        select: { id: true, name: true, walletBalance: true },
      });
      if (!sender) {
        throw new Error('Sender not found');
      }

      const senderWalletBalance = Number(sender.walletBalance ?? 0);
      const [wins, consumed] = await Promise.all([
        tx.transaction.aggregate({
          where: {
            userId: senderId,
            type: { in: ['tournament_win'] },
            status: 'completed',
          },
          _sum: { amount: true },
        }),
        tx.transaction.aggregate({
          where: {
            userId: senderId,
            type: { in: ['withdrawal', 'gift_sent_withdrawable'] },
            status: { in: ['pending', 'completed'] },
          },
          _sum: { amount: true },
        }),
      ]);
      const withdrawableBalance = Math.max(
        0,
        (wins._sum.amount ?? 0) - (consumed._sum.amount ?? 0),
      );
      const addedBalance = getAddedBalance(senderWalletBalance, withdrawableBalance);

      if (normalizedSource === 'withdrawable' && giftAmount > withdrawableBalance) {
        throw new Error('Insufficient withdrawable balance');
      }
      if (normalizedSource === 'added' && giftAmount > addedBalance) {
        throw new Error('Insufficient added balance');
      }

      const recipient = await tx.user.findUnique({
        where: { id: recipientId },
        select: { id: true, name: true, walletBalance: true },
      });

      if (!recipient) {
        throw new Error('Recipient not found');
      }

      await tx.user.update({
        where: { id: senderId },
        data: { walletBalance: { decrement: giftAmount } },
      });

      await tx.user.update({
        where: { id: recipientId },
        data: { walletBalance: { increment: giftAmount } },
      });

      // Create transaction records
      const senderLabel = sender.name?.trim()
        ? `${sender.name} (${sender.id})`
        : sender.id;
      const recipientLabel = recipient.name?.trim()
        ? `${recipient.name} (${recipient.id})`
        : recipient.id;

      await tx.transaction.create({
        data: {
          userId: senderId,
          type: normalizedSource === 'withdrawable' ? 'gift_sent_withdrawable' : 'gift_sent',
          amount: giftAmount,
          status: 'completed',
          reference: `Gift to ${recipientLabel}${message ? `: ${message}` : ''} [source:${normalizedSource}]`,
        },
      });

      await tx.transaction.create({
        data: {
          userId: recipientId,
          type: 'gift_received',
          amount: giftAmount,
          status: 'completed',
          reference: `Gift from ${senderLabel}${message ? `: ${message}` : ''} [source:${normalizedSource}]`,
        },
      });

      return {
        senderId: sender.id,
        senderName: sender.name ?? 'User',
        recipientId: recipient.id,
        recipientName: recipient.name ?? 'User',
        amount: giftAmount,
        sourceBalance: normalizedSource,
        message: message ? String(message) : '',
        senderNewWalletBalance: senderWalletBalance - giftAmount,
        recipientNewWalletBalance: Number(recipient.walletBalance ?? 0) + giftAmount,
      };
    });

    await Promise.allSettled([
      sendPushToUser(result.senderId, {
        title: 'Gift sent',
        body:
          `You sent Rs ${result.amount.toFixed(2)} to ${result.recipientName} from ${result.sourceBalance} balance.` +
          (result.message ? ` Message: ${result.message}` : ''),
        category: 'WALLET',
        data: {
          type: 'wallet_gift_sent',
          recipientId: result.recipientId,
          recipientName: result.recipientName,
          amount: String(result.amount),
        },
      }),
      sendPushToUser(result.recipientId, {
        title: 'Gift received',
        body:
          `You received Rs ${result.amount.toFixed(2)} from ${result.senderName}.` +
          (result.message ? ` Message: ${result.message}` : ''),
        category: 'WALLET',
        data: {
          type: 'wallet_gift_received',
          senderId: result.senderId,
          senderName: result.senderName,
          amount: String(result.amount),
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      message: 'Gift sent successfully',
      newWalletBalance: result.senderNewWalletBalance,
    });
  } catch (error: any) {
    console.error('Error sending gift:', error);
    
    if (
      error.message === 'Insufficient withdrawable balance' ||
      error.message === 'Insufficient added balance'
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }
    
    if (error.message === 'Sender not found' || error.message === 'Recipient not found') {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to send gift' },
      { status: 500 }
    );
  }
}
