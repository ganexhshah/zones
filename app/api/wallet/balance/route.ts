import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';
import { getWithdrawableWinningBalance } from '@/lib/gift-balance';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const user = await prisma.user.findUnique({
      where: { id: auth.user.id },
      select: { walletBalance: true },
    });
    const winningBalance = await getWithdrawableWinningBalance(auth.user.id);

    return NextResponse.json({
      balance: user?.walletBalance || 0,
      winningBalance,
    });
  } catch (error) {
    console.error('Wallet balance error:', error);
    return NextResponse.json({ error: 'Failed to fetch balance' }, { status: 500 });
  }
}
