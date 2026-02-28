import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthPayload } from '@/lib/route-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuthPayload(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const tournament = await prisma.tournament.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        title: true,
        maxPlayers: true,
        status: true,
      },
    });

    if (!tournament) {
      return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
    }

    const participants = await prisma.tournamentParticipant.findMany({
      where: { tournamentId: params.id },
      orderBy: { joinedAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            gameIds: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { gameId: true },
            },
          },
        },
      },
    });

    const userIds = participants.map((p) => p.userId);
    const registrations = userIds.length
      ? await prisma.tournamentRegistration.findMany({
          where: {
            tournamentId: params.id,
            userId: { in: userIds },
          },
          select: { id: true, userId: true },
        })
      : [];
    const regMap = new Map(
      registrations
        .filter((r) => !!r.userId)
        .map((r) => [r.userId as string, r.id]),
    );

    const match = await prisma.tournamentMatch.findFirst({
      where: { tournamentId: params.id },
      orderBy: [
        { roundNo: 'desc' },
        { matchIndex: 'desc' },
        { updatedAt: 'desc' },
      ],
      include: {
        participants: {
          select: {
            registrationId: true,
            isWinner: true,
          },
        },
      },
    });

    const players = participants.map((p) => ({
      userId: p.userId,
      registrationId: regMap.get(p.userId) ?? null,
      displayName: p.user.name || p.user.email || 'Player',
      gameUid: p.user.gameIds[0]?.gameId || '-',
      joinedAt: p.joinedAt,
    }));

    return NextResponse.json({
      tournament,
      players,
      match: match
        ? {
            id: match.id,
            status: match.status,
            roomId: match.roomId,
            roomPass: match.roomPass,
            participants: match.participants,
          }
        : null,
    });
  } catch (error) {
    console.error('Admin tournament manage-data error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch manage data' },
      { status: 500 },
    );
  }
}
