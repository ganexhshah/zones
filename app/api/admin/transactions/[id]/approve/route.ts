import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { sendPushToUser } from '@/lib/push';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const transaction = await prisma.transaction.findUnique({
      where: { id: params.id },
      include: { user: true },
    });

    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    if (transaction.status !== 'pending') {
      return NextResponse.json({ error: 'Transaction already processed' }, { status: 400 });
    }

    if (transaction.type === 'withdrawal' && transaction.user.walletBalance < transaction.amount) {
      return NextResponse.json(
        { error: 'User has insufficient wallet balance for withdrawal approval' },
        { status: 400 }
      );
    }

    const walletDelta =
      transaction.type === 'deposit'
        ? transaction.amount
        : transaction.type === 'withdrawal'
        ? -transaction.amount
        : 0;

    const [updatedTransaction, updatedUser] = await prisma.$transaction([
      prisma.transaction.update({
        where: { id: params.id },
        data: { status: 'completed' },
      }),
      prisma.user.update({
        where: { id: transaction.userId },
        data: {
          walletBalance: {
            increment: walletDelta,
          },
        },
      }),
    ]);

    if (transaction.user.email) {
      const isWithdrawal = transaction.type === 'withdrawal';
      await sendEmail(
        transaction.user.email,
        isWithdrawal ? 'Withdrawal Approved' : 'Payment Approved',
        `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>${isWithdrawal ? 'Withdrawal Approved' : 'Payment Approved'}!</h2>
            <p>Hi ${transaction.user.name || 'User'},</p>
            <p>Your ${isWithdrawal ? 'withdrawal request has been approved' : 'payment has been verified and approved'}.</p>
            <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p><strong>Amount:</strong> Rs ${transaction.amount}</p>
              <p><strong>Status:</strong> Completed</p>
              <p><strong>Transaction ID:</strong> ${transaction.id}</p>
            </div>
            <p>Your wallet has been ${isWithdrawal ? 'debited' : 'credited'} with Rs ${transaction.amount}.</p>
            <p><strong>Current Wallet Balance:</strong> Rs ${updatedUser.walletBalance}</p>
            <p>Thank you for using CrackZones Gaming!</p>
          </div>
        `
      );
    }

    await sendPushToUser(transaction.userId, {
      title: transaction.type === 'withdrawal' ? 'Withdrawal Approved' : 'Deposit Approved',
      body:
        transaction.type === 'withdrawal'
          ? `Your withdrawal of Rs ${transaction.amount.toFixed(2)} is completed.`
          : `Rs ${transaction.amount.toFixed(2)} has been added to your wallet.`,
      data: {
        type: transaction.type,
        status: 'completed',
        transactionId: updatedTransaction.id,
      },
    });

    return NextResponse.json({ transaction: updatedTransaction });
  } catch (error) {
    console.error('Approve transaction error:', error);
    return NextResponse.json({ error: 'Failed to approve transaction' }, { status: 500 });
  }
}
