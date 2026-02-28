import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const registrations = await prisma.tournamentRegistration.findMany({
      where: {
        OR: [
          { userId: auth.user.id },
          { team: { members: { some: { userId: auth.user.id, status: 'ACTIVE' } } } },
        ],
      },
      include: {
        tournament: {
          select: {
            id: true,
            title: true,
            game: true,
            mode: true,
            status: true,
          },
        },
        matchParticipants: {
          include: {
            match: {
              select: {
                id: true,
                roundNo: true,
                matchIndex: true,
                roomId: true,
                roomPass: true,
                status: true,
                scheduledAt: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });

    const matchIds = registrations.flatMap((reg) =>
      reg.matchParticipants.map((mp) => mp.match.id),
    );
    const uniqueMatchIds = Array.from(new Set(matchIds));

    const winnerRows = uniqueMatchIds.length
      ? await prisma.tournamentMatchParticipant.findMany({
          where: {
            matchId: { in: uniqueMatchIds },
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
        })
      : [];

    const winnerByMatchId = new Map(
      winnerRows.map((row) => [
        row.matchId,
        row.registration.team
          ? { type: 'team', id: row.registration.team.id, name: row.registration.team.name }
          : {
              type: 'user',
              id: row.registration.user?.id,
              name: row.registration.user?.name || row.registration.user?.email || 'Unknown',
            },
      ]),
    );

    const alerts = registrations.flatMap((reg) =>
      reg.matchParticipants.map((mp) => ({
        tournamentId: reg.tournament.id,
        tournamentTitle: reg.tournament.title,
        tournamentStatus: reg.tournament.status,
        matchId: mp.match.id,
        roundNo: mp.match.roundNo,
        matchIndex: mp.match.matchIndex,
        roomId: mp.match.roomId,
        roomPass: mp.match.roomPass,
        matchStatus: mp.match.status,
        scheduledAt: mp.match.scheduledAt,
        updatedAt: mp.match.updatedAt,
        winner: winnerByMatchId.get(mp.match.id) || null,
      })),
    );

    alerts.sort((a, b) => {
      const aTs = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTs = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTs - aTs;
    });

    return NextResponse.json({ alerts });
  } catch (error) {
    console.error('Tournament alerts error:', error);
    return NextResponse.json({ error: 'Failed to fetch tournament alerts' }, { status: 500 });
  }
}

