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
    let rejectNote = '';
    try {
      const body = await req.json();
      rejectNote = (body?.note || '').toString().trim();
    } catch {
      // keep backward compatibility
    }

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

    if (!rejectNote) {
      return NextResponse.json({ error: 'Reject note is required' }, { status: 400 });
    }

    const updatedTransaction = await prisma.transaction.update({
      where: { id: params.id },
      data: {
        status: 'rejected',
        reference: rejectNote,
      },
    });

    if (transaction.user.email) {
      const isWithdrawal = transaction.type === 'withdrawal';
      await sendEmail(
        transaction.user.email,
        isWithdrawal ? 'Withdrawal Rejected' : 'Payment Rejected',
        `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>${isWithdrawal ? 'Withdrawal Rejected' : 'Payment Rejected'}</h2>
            <p>Hi ${transaction.user.name || 'User'},</p>
            <p>Unfortunately, your ${isWithdrawal ? 'withdrawal request' : 'payment request'} has been rejected.</p>
            <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p><strong>Amount:</strong> Rs ${transaction.amount}</p>
              <p><strong>Status:</strong> Rejected</p>
              <p><strong>Transaction ID:</strong> ${transaction.id}</p>
              <p><strong>Reason:</strong> ${rejectNote}</p>
            </div>
            <p>Please contact support if you believe this is an error.</p>
            <p>Thank you for using CrackZones Gaming!</p>
          </div>
        `
      );
    }

    await sendPushToUser(transaction.userId, {
      title: transaction.type === 'withdrawal' ? 'Withdrawal Rejected' : 'Deposit Rejected',
      body: rejectNote
        ? `Reason: ${rejectNote}`
        : `${transaction.type === 'withdrawal' ? 'Withdrawal' : 'Deposit'} request was rejected.`,
      data: {
        type: transaction.type,
        status: 'rejected',
        transactionId: updatedTransaction.id,
      },
    });

    return NextResponse.json({ transaction: updatedTransaction });
  } catch (error) {
    console.error('Reject transaction error:', error);
    return NextResponse.json({ error: 'Failed to reject transaction' }, { status: 500 });
  }
}
