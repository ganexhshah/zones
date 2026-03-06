import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const tournamentId = params.id;

    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                avatar: true,
                email: true,
              },
            },
          },
          orderBy: {
            joinedAt: 'asc',
          },
        },
      },
    });

    if (!tournament) {
      return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
    }

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
        ...tournament,
        roomId: roomSourceMatch?.roomId ?? null,
        roomPassword: roomSourceMatch?.roomPass ?? null,
        currentPlayers: tournament.participants.length,
      },
    });
  } catch (error) {
    console.error('Get tournament details error:', error);
    return NextResponse.json({ error: 'Failed to fetch tournament details' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const tournamentId = params.id;
    const body = await req.json().catch(() => ({}));

    const updateData: any = {};
    const shouldUpdateRoom =
      body.roomId !== undefined || body.roomPassword !== undefined;
    const normalizedRoomId =
      body.roomId !== undefined
        ? body.roomId
          ? String(body.roomId).trim()
          : null
        : undefined;
    const normalizedRoomPass =
      body.roomPassword !== undefined
        ? body.roomPassword
          ? String(body.roomPassword).trim()
          : null
        : undefined;

    if (body.status !== undefined) {
      updateData.status = String(body.status).trim().toLowerCase();
    }

    if (body.title !== undefined) {
      updateData.title = String(body.title).trim();
    }

    if (body.entryFee !== undefined) {
      updateData.entryFee = Number(body.entryFee);
    }

    if (body.prizePool !== undefined) {
      updateData.prizePool = Number(body.prizePool);
    }

    if (body.maxPlayers !== undefined) {
      updateData.maxPlayers = Number(body.maxPlayers);
    }

    if (body.startTime !== undefined) {
      updateData.startTime = new Date(body.startTime);
    }

    const tournamentExists = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, startTime: true, status: true },
    });
    if (!tournamentExists) {
      return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
    }

    if (shouldUpdateRoom) {
      const targetMatch =
        await prisma.tournamentMatch.findFirst({
          where: {
            tournamentId,
            status: { in: ['LIVE', 'SCHEDULED'] },
          },
          orderBy: [
            { roundNo: 'asc' },
            { matchIndex: 'asc' },
            { createdAt: 'asc' },
          ],
        }) ??
        await prisma.tournamentMatch.findFirst({
          where: { tournamentId },
          orderBy: { createdAt: 'desc' },
        });

      if (targetMatch) {
        await prisma.tournamentMatch.update({
          where: { id: targetMatch.id },
          data: {
            ...(normalizedRoomId !== undefined ? { roomId: normalizedRoomId } : {}),
            ...(normalizedRoomPass !== undefined ? { roomPass: normalizedRoomPass } : {}),
          },
        });
      } else {
        await prisma.tournamentMatch.create({
          data: {
            tournamentId,
            roundNo: 1,
            matchIndex: 1,
            status:
              tournamentExists.status.toLowerCase() === 'live' ? 'LIVE' : 'SCHEDULED',
            scheduledAt: tournamentExists.startTime ?? new Date(),
            roomId: normalizedRoomId ?? null,
            roomPass: normalizedRoomPass ?? null,
          },
        });
      }
    }

    const tournament =
      Object.keys(updateData).length > 0
        ? await prisma.tournament.update({
            where: { id: tournamentId },
            data: updateData,
          })
        : await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });

    return NextResponse.json({ tournament });
  } catch (error: any) {
    console.error('Update tournament error:', error);
    if (error.code === 'P2025') {
      return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to update tournament' }, { status: 500 });
  }
}
