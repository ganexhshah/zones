import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { sendPushToUser } from '@/lib/push';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }

    const { transaction, updatedUser, updatedTransaction } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Transaction" WHERE id = ${params.id} FOR UPDATE`;

      const transaction = await tx.transaction.findUnique({
        where: { id: params.id },
        include: { user: true },
      });
      if (!transaction) {
        throw Object.assign(new Error('Transaction not found'), { code: 'TX_NOT_FOUND' });
      }
      if (transaction.status !== 'pending') {
        throw Object.assign(new Error('Transaction already processed'), { code: 'TX_ALREADY_PROCESSED' });
      }

      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${transaction.userId} FOR UPDATE`;
      const lockedUser = await tx.user.findUnique({
        where: { id: transaction.userId },
        select: { id: true, walletBalance: true },
      });
      if (!lockedUser) {
        throw Object.assign(new Error('User not found'), { code: 'USER_NOT_FOUND' });
      }
      if (transaction.type === 'withdrawal' && lockedUser.walletBalance < transaction.amount) {
        throw Object.assign(new Error('User has insufficient wallet balance for withdrawal approval'), {
          code: 'INSUFFICIENT_BALANCE',
        });
      }

      const walletDelta =
        transaction.type === 'deposit'
          ? transaction.amount
          : transaction.type === 'withdrawal'
          ? -transaction.amount
          : 0;

      const statusUpdate = await tx.transaction.updateMany({
        where: { id: params.id, status: 'pending' },
        data: { status: 'completed' },
      });
      if (statusUpdate.count !== 1) {
        throw Object.assign(new Error('Transaction already processed'), { code: 'TX_ALREADY_PROCESSED' });
      }

      const updatedUser = walletDelta === 0
        ? await tx.user.findUniqueOrThrow({ where: { id: transaction.userId } })
        : await tx.user.update({
            where: { id: transaction.userId },
            data: {
              walletBalance: {
                increment: walletDelta,
              },
            },
          });
      const updatedTransaction = await tx.transaction.findUniqueOrThrow({
        where: { id: params.id },
      });

      return { transaction, updatedUser, updatedTransaction };
    });

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
    const code = (error as { code?: string })?.code;
    if (code === 'TX_NOT_FOUND') {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }
    if (code === 'TX_ALREADY_PROCESSED') {
      return NextResponse.json({ error: 'Transaction already processed' }, { status: 400 });
    }
    if (code === 'INSUFFICIENT_BALANCE') {
      return NextResponse.json(
        { error: 'User has insufficient wallet balance for withdrawal approval' },
        { status: 400 },
      );
    }
    console.error('Approve transaction error:', error);
    return NextResponse.json({ error: 'Failed to approve transaction' }, { status: 500 });
  }
}
