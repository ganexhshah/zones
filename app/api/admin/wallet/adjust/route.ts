import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { sendPushToUser } from '@/lib/push';

export async function POST(req: NextRequest) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const { userId, amount, reason } = await req.json();

    if (!userId || amount === undefined || !reason) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    const { user, updatedUser, transaction } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;

      const user = await tx.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        throw Object.assign(new Error('User not found'), { code: 'USER_NOT_FOUND' });
      }

      if (numAmount < 0 && user.walletBalance + numAmount < 0) {
        throw Object.assign(new Error('Insufficient balance'), { code: 'INSUFFICIENT_BALANCE' });
      }

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          walletBalance: {
            increment: numAmount,
          },
        },
      });
      const transaction = await tx.transaction.create({
        data: {
          userId,
          type: numAmount > 0 ? 'admin_credit' : 'admin_debit',
          amount: Math.abs(numAmount),
          status: 'completed',
          method: 'admin_adjustment',
          reference: reason,
        },
      });
      return { user, updatedUser, transaction };
    });

    // Send email notification
    if (user.email) {
      await sendEmail(
        user.email,
        numAmount > 0 ? 'Balance Added to Your Wallet' : 'Balance Deducted from Your Wallet',
        `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>${numAmount > 0 ? 'Balance Added' : 'Balance Deducted'}</h2>
            <p>Hi ${user.name || 'User'},</p>
            <p>Your wallet balance has been ${numAmount > 0 ? 'credited' : 'debited'} by admin.</p>
            <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p><strong>Amount:</strong> ₹${Math.abs(numAmount)}</p>
              <p><strong>Action:</strong> ${numAmount > 0 ? 'Credit' : 'Debit'}</p>
              <p><strong>Reason:</strong> ${reason}</p>
              <p><strong>New Balance:</strong> ₹${updatedUser.walletBalance}</p>
            </div>
            <p>If you have any questions, please contact support.</p>
            <p>Thank you for using CrackZones Gaming!</p>
          </div>
        `
      );
    }

    await sendPushToUser(userId, {
      title: 'Admin Wallet Adjustment',
      body:
        numAmount > 0
          ? `Admin credited Rs ${Math.abs(numAmount).toFixed(2)}.`
          : `Admin debited Rs ${Math.abs(numAmount).toFixed(2)}.`,
      data: {
        type: numAmount > 0 ? 'admin_credit' : 'admin_debit',
        status: 'completed',
        transactionId: transaction.id,
      },
    });

    return NextResponse.json({
      user: updatedUser,
      transaction,
      message: 'Wallet adjusted successfully',
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (code === 'INSUFFICIENT_BALANCE') {
      return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 });
    }
    console.error('Adjust wallet error:', error);
    return NextResponse.json({ error: 'Failed to adjust wallet' }, { status: 500 });
  }
}
