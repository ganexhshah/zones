import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    console.log('Fetching stats for user:', auth.user.id);

    const tournamentParticipations = await prisma.tournamentParticipant.findMany({
      where: { userId: auth.user.id },
      include: {
        tournament: {
          select: {
            id: true,
            title: true,
            game: true,
            status: true,
            startTime: true,
            entryFee: true,
            prizePool: true,
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
      take: 30,
    });

    console.log('Tournament participations fetched:', tournamentParticipations.length);

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: auth.user.id,
        type: { in: ['tournament_win'] },
        status: 'completed',
      },
      orderBy: { createdAt: 'desc' },
    });

    console.log('Transactions fetched:', transactions.length);

    const totalMatches = tournamentParticipations.length;
    const wins = transactions.length;
    const losses = Math.max(0, totalMatches - wins);
    const winRate = totalMatches > 0 ? ((wins / totalMatches) * 100).toFixed(0) : '0';
    const totalWinnings = transactions.reduce((sum, t) => sum + t.amount, 0);

    const matchHistory = tournamentParticipations.map((p) => {
      const t = p.tournament;
      return {
        id: t.id,
        title: t.title,
        mode: t.game,
        result: t.status === 'completed' ? 'Played' : 'Registered',
        amount: t.prizePool,
        isWin: false,
        time: t.startTime,
        opponent: '-',
      };
    });

    const stats = {
      totalMatches,
      wins,
      losses,
      winRate: `${winRate}%`,
      totalEarnings: totalWinnings,
      tournamentsPlayed: tournamentParticipations.length,
      bestStreak: 0,
      rank: 0,
      matchHistory,
    };

    return NextResponse.json({ stats });
  } catch (error) {
    console.error('Stats fetch error:', error);
    console.error('Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
