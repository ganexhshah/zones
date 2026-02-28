import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    let registrations = await prisma.tournamentRegistration.findMany({
      where: {
        tournamentId: params.id,
        OR: [
          { userId: auth.user.id },
          { team: { members: { some: { userId: auth.user.id, status: 'ACTIVE' } } } },
        ],
      },
      include: {
        team: { select: { id: true, name: true, captainId: true } },
        matchParticipants: {
          include: {
            match: true,
          },
        },
      },
    });

    // Backward compatibility: if user joined old flow (participant only), create/get registration.
    if (registrations.length === 0) {
      const participant = await prisma.tournamentParticipant.findFirst({
        where: {
          tournamentId: params.id,
          userId: auth.user.id,
        },
      });
      if (participant) {
        await prisma.tournamentRegistration.upsert({
          where: {
            tournamentId_userId: {
              tournamentId: params.id,
              userId: auth.user.id,
            },
          },
          update: {
            paid: true,
            status: 'APPROVED',
            approvedAt: new Date(),
          },
          create: {
            tournamentId: params.id,
            userId: auth.user.id,
            paid: true,
            status: 'APPROVED',
            approvedAt: new Date(),
          },
        });

        registrations = await prisma.tournamentRegistration.findMany({
          where: {
            tournamentId: params.id,
            OR: [
              { userId: auth.user.id },
              { team: { members: { some: { userId: auth.user.id, status: 'ACTIVE' } } } },
            ],
          },
          include: {
            team: { select: { id: true, name: true, captainId: true } },
            matchParticipants: {
              include: {
                match: true,
              },
            },
          },
        });
      }
    }

    if (registrations.length === 0) {
      return NextResponse.json({ error: 'No registration found' }, { status: 404 });
    }

    const matchIds = registrations.flatMap((reg) =>
      reg.matchParticipants.map((mp) => mp.match.id),
    );

    const winnerRows = matchIds.length === 0
      ? []
      : await prisma.tournamentMatchParticipant.findMany({
          where: {
            matchId: { in: Array.from(new Set(matchIds)) },
            isWinner: true,
          },
          include: {
            registration: {
              include: {
                user: { select: { id: true, name: true, email: true } },
                team: { select: { id: true, name: true } },
              },
            },
          },
        });

    const winnerByMatchId = new Map(
      winnerRows.map((w) => [
        w.matchId,
        w.registration.team
          ? { type: 'team', id: w.registration.team.id, name: w.registration.team.name }
          : {
              type: 'user',
              id: w.registration.user?.id,
              name: w.registration.user?.name || w.registration.user?.email || 'Unknown',
            },
      ]),
    );

    const matches = registrations.flatMap((reg) =>
      reg.matchParticipants.map((mp) => ({
        registrationId: reg.id,
        participant: reg.team ? { type: 'team', id: reg.team.id, name: reg.team.name } : { type: 'user', id: reg.userId, name: auth.user.name || auth.user.email },
        match: {
          id: mp.match.id,
          roundNo: mp.match.roundNo,
          matchIndex: mp.match.matchIndex,
          groupNo: mp.match.groupNo,
          roomId: mp.match.roomId,
          roomPass: mp.match.roomPass,
          scheduledAt: mp.match.scheduledAt,
          status: mp.match.status,
          slotNo: mp.slotNo,
          winner: winnerByMatchId.get(mp.match.id) || null,
        },
      }))
    );

    return NextResponse.json({
      registrations: registrations.map((r) => ({
        id: r.id,
        status: r.status,
        checkinStatus: r.checkinStatus,
        team: r.team,
      })),
      matches,
    });
  } catch (error) {
    console.error('Lobby error:', error);
    return NextResponse.json({ error: 'Failed to fetch lobby info' }, { status: 500 });
  }
}
