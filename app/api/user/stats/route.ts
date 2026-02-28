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
            title: true,
            prizePool: true,
            status: true,
          },
        },
      },
    });

    // Get user's custom matches as creator
    const customMatchesAsCreator = await prisma.customMatch.findMany({
      where: {
        createdByUserId: payload.userId,
      },
      include: {
        createdBy: {
          select: { id: true, name: true },
        },
        participants: {
          include: {
            user: {
              select: { id: true, name: true },
            },
          },
        },
        resultSubmissions: {
          where: { status: 'APPROVED' },
          select: {
            winnerUserId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Get user's custom matches as participant
    const participantRecords = await prisma.customMatchParticipant.findMany({
      where: {
        userId: payload.userId,
      },
      include: {
        customMatch: {
          include: {
            createdBy: {
              select: { id: true, name: true },
            },
            participants: {
              include: {
                user: {
                  select: { id: true, name: true },
                },
              },
            },
            resultSubmissions: {
              where: { status: 'APPROVED' },
              select: {
                winnerUserId: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Combine and deduplicate matches
    const allMatchesMap = new Map();
    
    customMatchesAsCreator.forEach(match => {
      allMatchesMap.set(match.id, match);
    });
    
    participantRecords.forEach(participant => {
      if (participant.customMatch && !allMatchesMap.has(participant.customMatch.id)) {
        allMatchesMap.set(participant.customMatch.id, participant.customMatch);
      }
    });

    const customMatches = Array.from(allMatchesMap.values());

    // Calculate stats
    const completedMatches = customMatches.filter(m => m.status === 'CLOSED');
    const totalMatches = completedMatches.length;
    
    let wins = 0;
    completedMatches.forEach(match => {
      const approvedResult = match.resultSubmissions?.[0];
      if (approvedResult?.winnerUserId === payload.userId) {
        wins++;
      }
    });
    
    const losses = totalMatches - wins;
    const winRate = totalMatches > 0 ? ((wins / totalMatches) * 100).toFixed(0) : '0';

    // Calculate total earnings from custom matches
    let totalEarnings = 0;
    completedMatches.forEach(match => {
      const approvedResult = match.resultSubmissions?.[0];
      if (approvedResult?.winnerUserId === payload.userId) {
        totalEarnings += match.entryFee * 2 * 0.9; // 90% payout after 10% platform fee
      }
    });

    // Get transaction history for more accurate earnings
    const transactions = await prisma.transaction.findMany({
      where: {
        userId: payload.userId,
        type: 'WIN',
      },
    });

    const totalWinnings = transactions.reduce((sum, t) => sum + t.amount, 0);

    // Format match history
    const matchHistory = customMatches.map(match => {
      const approvedResult = match.resultSubmissions?.[0];
      const isWin = approvedResult?.winnerUserId === payload.userId;
      const isCreator = match.createdByUserId === payload.userId;
      
      // Find opponent
      let opponentName = 'Unknown';
      if (isCreator) {
        const opponent = match.participants?.find((p: any) => p.userId !== payload.userId);
        opponentName = opponent?.user?.name || 'Waiting';
      } else {
        opponentName = match.createdBy?.name || 'Unknown';
      }
      
      return {
        id: match.id,
        title: match.title || `${match.mode} - ${match.roomType}`,
        mode: match.mode,
        result: match.status === 'CLOSED' ? (isWin ? 'Won' : 'Lost') : 'Cancelled',
        amount: match.entryFee * 2 * 0.9,
        isWin,
        time: match.updatedAt,
        opponent: opponentName,
      };
    });

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
