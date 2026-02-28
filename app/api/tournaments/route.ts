import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const tournaments = await prisma.tournament.findMany({
      include: {
        participants: {
          select: { 
            id: true,
            userId: true,
          },
        },
      },
      orderBy: { startTime: 'asc' },
    });

    const formattedTournaments = tournaments.map(t => ({
      ...t,
      currentPlayers: t.participants.length,
    }));

    return NextResponse.json({ tournaments: formattedTournaments });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch tournaments' }, { status: 500 });
  }
}
