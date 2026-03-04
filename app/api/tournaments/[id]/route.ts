import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

function getAuthPayload(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  return verifyToken(token);
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const payload = getAuthPayload(req);
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tournamentId = params.id;

    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        participants: {
          where: {
            userId: payload.userId,
          },
        },
      },
    });

    if (!tournament) {
      return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
    }

    const isRegistered = tournament.participants.length > 0;

    // Only show room details if user is registered and tournament is live or completed
    const showRoomDetails = isRegistered && ['live', 'completed'].includes(tournament.status.toLowerCase());

    const activeOrUpcomingMatch = await prisma.tournamentMatch.findFirst({
      where: {
        tournamentId,
        status: { in: ['LIVE', 'SCHEDULED'] },
      },
      orderBy: [
        { roundNo: 'asc' },
        { matchIndex: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    const fallbackMatchWithRoom = activeOrUpcomingMatch
      ? null
      : await prisma.tournamentMatch.findFirst({
          where: {
            tournamentId,
            OR: [{ roomId: { not: null } }, { roomPass: { not: null } }],
          },
          orderBy: { createdAt: 'desc' },
        });
    const roomSourceMatch = activeOrUpcomingMatch ?? fallbackMatchWithRoom;

    return NextResponse.json({
      tournament: {
        id: tournament.id,
        title: tournament.title,
        game: tournament.game,
        mode: tournament.mode,
        format: tournament.format,
        entryFee: tournament.entryFee,
        prizePool: tournament.prizePool,
        maxPlayers: tournament.maxPlayers,
        startTime: tournament.startTime,
        status: tournament.status,
        isRegistered,
        roomId: showRoomDetails ? roomSourceMatch?.roomId ?? null : null,
        roomPassword: showRoomDetails ? roomSourceMatch?.roomPass ?? null : null,
      },
    });
  } catch (error) {
    console.error('Get tournament details error:', error);
    return NextResponse.json({ error: 'Failed to fetch tournament details' }, { status: 500 });
  }
}
