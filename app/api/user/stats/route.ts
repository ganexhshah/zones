import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

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

    // Get user's tournament participations
    const tournamentParticipations = await prisma.tournamentParticipant.findMany({
      where: { userId: payload.userId },
      include: {
        tournament: {
          select: {
            name: true,
            prizePool: true,
            status: true,
          },
        },
      },
    });

    // Get user's custom matches
    const customMatches = await prisma.customMatch.findMany({
      where: {
        OR: [
          { creatorId: payload.userId },
          { opponentId: payload.userId },
        ],
        status: { in: ['COMPLETED', 'CANCELLED'] },
      },
      include: {
        creator: {
          select: { id: true, name: true },
        },
        opponent: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Calculate stats
    const totalMatches = customMatches.filter(m => m.status === 'COMPLETED').length;
    const wins = customMatches.filter(m => m.winnerId === payload.userId).length;
    const losses = totalMatches - wins;
    const winRate = totalMatches > 0 ? ((wins / totalMatches) * 100).toFixed(0) : '0';

    // Calculate total earnings from custom matches
    const totalEarnings = customMatches
      .filter(m => m.winnerId === payload.userId)
      .reduce((sum, match) => sum + (match.entryFee * 2 * 0.9), 0); // 90% payout after 10% platform fee

    // Get transaction history for more accurate earnings
    const transactions = await prisma.transaction.findMany({
      where: {
        userId: payload.userId,
        type: 'WIN',
      },
    });

    const totalWinnings = transactions.reduce((sum, t) => sum + t.amount, 0);

    // Format match history
    const matchHistory = customMatches.map(match => ({
      id: match.id,
      title: `${match.mode} - ${match.roomType}`,
      mode: match.mode,
      result: match.winnerId === payload.userId ? 'Won' : match.status === 'COMPLETED' ? 'Lost' : 'Cancelled',
      amount: match.entryFee * 2 * 0.9,
      isWin: match.winnerId === payload.userId,
      time: match.updatedAt,
      opponent: match.creatorId === payload.userId ? match.opponent?.name : match.creator?.name,
    }));

    const stats = {
      totalMatches,
      wins,
      losses,
      winRate: `${winRate}%`,
      totalEarnings: totalWinnings,
      tournamentsPlayed: tournamentParticipations.length,
      bestStreak: 0, // TODO: Calculate streak
      rank: 0, // TODO: Implement ranking system
      matchHistory,
    };

    return NextResponse.json({ stats });
  } catch (error) {
    console.error('Stats fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
