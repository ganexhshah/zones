import { prisma } from '@/lib/prisma';

export async function getWithdrawableWinningBalance(userId: string) {
  const [wins, consumed] = await Promise.all([
    prisma.transaction.aggregate({
      where: {
        userId,
        type: { in: ['tournament_win'] },
        status: 'completed',
      },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: {
        userId,
        type: { in: ['withdrawal', 'gift_sent_withdrawable'] },
        status: { in: ['pending', 'completed'] },
      },
      _sum: { amount: true },
    }),
  ]);

  const totalWins = wins._sum.amount ?? 0;
  const used = consumed._sum.amount ?? 0;
  return Math.max(0, totalWins - used);
}

export function getAddedBalance(walletBalance: number, withdrawableBalance: number) {
  return Math.max(0, walletBalance - withdrawableBalance);
}
