import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const tournamentParticipations = await prisma.tournamentParticipant.findMany({
      where: { userId: payload.userId },
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

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: payload.userId,
        type: { in: ['tournament_win'] },
        status: 'completed',
      },
      orderBy: { createdAt: 'desc' },
    });

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
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
