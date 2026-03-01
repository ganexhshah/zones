import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';
import { sendPushToUser } from '@/lib/push';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuthUser(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const body = await request.json();
    const { recipientId, amount, message } = body;

    if (!recipientId || !amount) {
      return NextResponse.json(
        { error: 'Recipient ID and amount are required' },
        { status: 400 }
      );
    }

    const senderId = authResult.user.id;

    // Validate amount
    if (amount <= 0) {
      return NextResponse.json(
        { error: 'Amount must be greater than 0' },
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

      // Check if sender has sufficient balance
      if (sender.walletBalance < amount) {
        throw new Error('Insufficient balance');
      }

      const recipient = await tx.user.findUnique({
        where: { id: recipientId },
        select: { id: true, name: true, walletBalance: true },
      });

      if (!recipient) {
        throw new Error('Recipient not found');
      }

      // Deduct from sender
      await tx.user.update({
        where: { id: senderId },
        data: { walletBalance: { decrement: amount } },
      });

      // Add to recipient
      await tx.user.update({
        where: { id: recipientId },
        data: { walletBalance: { increment: amount } },
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
          type: 'gift_sent',
          amount: -amount,
          status: 'completed',
          reference: `Gift to ${recipientLabel}${message ? `: ${message}` : ''}`,
        },
      });

      await tx.transaction.create({
        data: {
          userId: recipientId,
          type: 'gift_received',
          amount: amount,
          status: 'completed',
          reference: `Gift from ${senderLabel}${message ? `: ${message}` : ''}`,
        },
      });

      return {
        senderId: sender.id,
        senderName: sender.name ?? 'User',
        recipientId: recipient.id,
        recipientName: recipient.name ?? 'User',
        amount,
        message: message ? String(message) : '',
        senderNewBalance: sender.walletBalance - amount,
        recipientNewBalance: recipient.walletBalance + amount,
      };
    });

    await Promise.allSettled([
      sendPushToUser(result.senderId, {
        title: 'Gift sent',
        body:
          `You sent Rs ${result.amount} gift to ${result.recipientName}.` +
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
          `You received Rs ${result.amount} gift from ${result.senderName}.` +
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
      newBalance: result.senderNewBalance,
    });
  } catch (error: any) {
    console.error('Error sending gift:', error);
    
    if (error.message === 'Insufficient balance') {
      return NextResponse.json(
        { error: 'Insufficient balance' },
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
