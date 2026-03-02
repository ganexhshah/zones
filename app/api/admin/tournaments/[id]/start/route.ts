import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';
import { requireAuthPayload } from '@/lib/route-auth';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const auth = requireAuthPayload(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }

    const body = await req.json().catch(() => ({}));
    const roomId = String(body.roomId || '').trim();
    const roomPass = String(body.roomPass || '').trim();
    const matchId = body.matchId ? String(body.matchId) : null;

    if (!roomId || !roomPass) {
      return NextResponse.json(
        { error: 'roomId and roomPass are required' },
        { status: 400 }
      );
    }

    const tournament = await prisma.tournament.findUnique({
      where: { id: params.id },
      select: { id: true, status: true },
    });

    if (!tournament) {
      return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
    }

    const scheduledAt = new Date();
    let match =
      matchId
        ? await prisma.tournamentMatch.findFirst({
            where: { id: matchId, tournamentId: params.id },
          })
        : await prisma.tournamentMatch.findFirst({
            where: {
              tournamentId: params.id,
              status: { in: ['SCHEDULED', 'LIVE'] },
            },
            orderBy: [
              { roundNo: 'asc' },
              { matchIndex: 'asc' },
              { createdAt: 'asc' },
            ],
          });

    if (!match) {
      match = await prisma.tournamentMatch.create({
        data: {
          tournamentId: params.id,
          roundNo: 1,
          matchIndex: 1,
          roomId,
          roomPass,
          scheduledAt,
          status: 'LIVE',
        },
      });
    } else {
      match = await prisma.tournamentMatch.update({
        where: { id: match.id },
        data: {
          roomId,
          roomPass,
          scheduledAt,
          status: 'LIVE',
        },
      });
    }

    // Ensure all joined users have registrations and match participant rows.
    const participants = await prisma.tournamentParticipant.findMany({
      where: { tournamentId: params.id },
      select: { userId: true },
    });
    const participantUserIds = participants.map((p) => p.userId);

    const existingRegistrations = await prisma.tournamentRegistration.findMany({
      where: { tournamentId: params.id },
      select: { id: true, userId: true },
      orderBy: { createdAt: 'asc' },
    });

    const regByUserId = new Map(
      existingRegistrations
        .filter((r) => !!r.userId)
        .map((r) => [r.userId as string, r.id]),
    );

    for (const userId of participantUserIds) {
      if (!regByUserId.has(userId)) {
        const created = await prisma.tournamentRegistration.create({
          data: {
            tournamentId: params.id,
            userId,
            paid: true,
            status: 'APPROVED',
            approvedAt: new Date(),
          },
          select: { id: true },
        });
        regByUserId.set(userId, created.id);
      }
    }

    const allRegistrationIds = Array.from(
      new Set([
        ...existingRegistrations.map((r) => r.id),
        ...Array.from(regByUserId.values()),
      ]),
    );

    for (let i = 0; i < allRegistrationIds.length; i++) {
      const registrationId = allRegistrationIds[i];
      await prisma.tournamentMatchParticipant.upsert({
        where: {
          matchId_registrationId: {
            matchId: match.id,
            registrationId,
          },
        },
        update: {
          joined: true,
          slotNo: i + 1,
        },
        create: {
          matchId: match.id,
          registrationId,
          joined: true,
          slotNo: i + 1,
        },
      });
    }

    const updatedTournament = await prisma.tournament.update({
      where: { id: params.id },
      data: {
        status: 'live',
      },
    });

    return NextResponse.json({
      success: true,
      tournament: updatedTournament,
      match,
    });
  } catch (error) {
    console.error('Admin start tournament error:', error);
    return NextResponse.json(
      { error: 'Failed to start tournament' },
      { status: 500 }
    );
  }
}
