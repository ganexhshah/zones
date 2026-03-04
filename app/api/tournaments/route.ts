import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

function getAuthPayload(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  return verifyToken(token);
}

export async function GET(req: NextRequest) {
  try {
    const payload = getAuthPayload(req);
    const userId = payload?.userId || null;

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

    const formattedTournaments = tournaments.map(t => {
      const isRegistered = userId ? t.participants.some(p => p.userId === userId) : false;
      return {
        ...t,
        currentPlayers: t.participants.length,
        isRegistered,
      };
    });

    return NextResponse.json({ tournaments: formattedTournaments });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch tournaments' }, { status: 500 });
  }
}
