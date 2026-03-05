import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';
import { getAddedBalance, getWithdrawableWinningBalance } from '@/lib/gift-balance';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuthUser(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const user = await prisma.user.findUnique({
      where: { id: authResult.user.id },
      select: { walletBalance: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const walletBalance = Number(user.walletBalance ?? 0);
    const withdrawableBalance = await getWithdrawableWinningBalance(authResult.user.id);
    const addedBalance = getAddedBalance(walletBalance, withdrawableBalance);

    return NextResponse.json({
      walletBalance,
      withdrawableBalance,
      addedBalance,
    });
  } catch (error) {
    console.error('Gift balance sources error:', error);
    return NextResponse.json({ error: 'Failed to load gift balances' }, { status: 500 });
  }
}
