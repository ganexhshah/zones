import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthPayload } from '@/lib/route-auth';
import { recalculateTournamentLeaderboard } from '@/lib/tournament-engine';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuthPayload(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const entries = await prisma.tournamentLeaderboardEntry.findMany({
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

    return NextResponse.json({ entries });
  } catch (error) {
    console.error('Admin get leaderboard error:', error);
    return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuthPayload(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const result = await recalculateTournamentLeaderboard(params.id);
    return NextResponse.json({ result });
  } catch (error: any) {
    console.error('Admin recalc leaderboard error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to recalculate leaderboard' }, { status: 500 });
  }
}
