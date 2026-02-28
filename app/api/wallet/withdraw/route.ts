import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { sendEmail } from '@/lib/email';

async function getWithdrawableWinningBalance(userId: string) {
  const [wins, completedWithdrawals, pendingWithdrawals] = await Promise.all([
    prisma.transaction.aggregate({
      where: { userId, type: 'tournament_win', status: 'completed' },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { userId, type: 'withdrawal', status: 'completed' },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { userId, type: 'withdrawal', status: 'pending' },
      _sum: { amount: true },
    }),
  ]);

  const totalWins = wins._sum.amount ?? 0;
  const used = (completedWithdrawals._sum.amount ?? 0) + (pendingWithdrawals._sum.amount ?? 0);
  return Math.max(0, totalWins - used);
}

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const amount = Number(body.amount);
    const method = (body.method || '').toString().trim().toLowerCase();
    const accountName = (body.accountName || '').toString().trim();
    const accountNumber = (body.accountNumber || '').toString().trim();

    if (!amount || !method || !accountName || !accountNumber) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }

    if (amount < 100) {
      return NextResponse.json({ error: 'Minimum withdrawal is Rs 100' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, name: true, walletBalance: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const winningBalance = await getWithdrawableWinningBalance(user.id);

    if (amount > winningBalance) {
      return NextResponse.json(
        {
          error: `You can withdraw only winning balance. Available winning balance: Rs ${winningBalance.toFixed(2)}`,
          winningBalance,
        },
        { status: 400 }
      );
    }

    if (amount > user.walletBalance) {
      return NextResponse.json(
        { error: `Insufficient wallet balance. Available: Rs ${user.walletBalance.toFixed(2)}` },
        { status: 400 }
      );
    }

    const reference = `Name: ${accountName} | Account: ${accountNumber}`;

    const transaction = await prisma.transaction.create({
      data: {
        userId: user.id,
        type: 'withdrawal',
        amount,
        method,
        status: 'pending',
        reference,
      },
    });

    if (user.email) {
      await sendEmail(
        user.email,
        'Withdrawal Request Submitted',
        `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Withdrawal Request Submitted</h2>
            <p>Hi ${user.name || 'User'},</p>
            <p>Your withdrawal request is pending admin review.</p>
            <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p><strong>Amount:</strong> Rs ${amount}</p>
              <p><strong>Method:</strong> ${method}</p>
              <p><strong>Status:</strong> Pending</p>
              <p><strong>Transaction ID:</strong> ${transaction.id}</p>
            </div>
            <p>You can withdraw only winning balance. Current withdrawable winning balance after this request: Rs ${(winningBalance - amount).toFixed(2)}</p>
          </div>
        `
      );
    }

    return NextResponse.json({
      message: 'Withdrawal request submitted successfully',
      transaction,
      winningBalance,
    });
  } catch (error) {
    console.error('Withdraw request error:', error);
    return NextResponse.json({ error: 'Failed to submit withdrawal request' }, { status: 500 });
  }
}
