import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recalculateTournamentLeaderboard } from '@/lib/tournament-engine';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(req.url);
    const recalc = searchParams.get('recalc') === '1';

    const tournament = await prisma.tournament.findUnique({
      where: { id: params.id },
      select: { id: true, title: true, mode: true, format: true, scoringConfig: true },
    });
    if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });

    if (recalc) {
      await recalculateTournamentLeaderboard(params.id);
    }

    const leaderboard = await prisma.tournamentLeaderboardEntry.findMany({
      where: { tournamentId: params.id },
      orderBy: [{ rank: 'asc' }, { points: 'desc' }],
      include: {
        registration: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            team: { select: { id: true, name: true } },
          },
        },
      },
    });

    return NextResponse.json({
      tournament,
      leaderboard: leaderboard.map((row) => ({
        id: row.id,
        rank: row.rank,
        points: row.points,
        kills: row.kills,
        placementPoints: row.placementPoints,
        bonusPoints: row.bonusPoints,
        matchesPlayed: row.matchesPlayed,
        wins: row.wins,
        participant: row.registration.team
          ? { type: 'team', id: row.registration.team.id, name: row.registration.team.name }
          : { type: 'user', id: row.registration.user?.id, name: row.registration.user?.name || row.registration.user?.email || 'Unknown' },
      })),
    });
  } catch (error) {
    console.error('Get leaderboard error:', error);
    return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
  }
}
