import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

function getAuthPayload(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '') ?? req.cookies.get('auth_token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function GET(req: NextRequest) {
  try {
    const payload = getAuthPayload(req);
    const userId = payload?.userId || null;

    const userRegistrations = userId
      ? await prisma.tournamentRegistration.findMany({
          where: { userId },
          select: { tournamentId: true },
        })
      : [];
    const registeredTournamentIds = new Set(
      userRegistrations.map((row) => row.tournamentId),
    );

    const tournaments = await prisma.tournament.findMany({
      select: {
        id: true,
        title: true,
        game: true,
        mode: true,
        format: true,
        region: true,
        entryFee: true,
        prizePool: true,
        currency: true,
        maxPlayers: true,
        roomSize: true,
        startTime: true,
        registrationOpenAt: true,
        registrationCloseAt: true,
        checkinOpenAt: true,
        checkinCloseAt: true,
        rulesText: true,
        scoringConfig: true,
        proofRequired: true,
        disputeWindowMinutes: true,
        refundRules: true,
        imageUrl: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { participants: true } },
      },
      orderBy: { startTime: 'asc' },
    });

    const formattedTournaments = tournaments.map((t) => {
      const { _count, ...safeTournament } = t;
      const isRegistered = userId
        ? registeredTournamentIds.has(t.id)
        : false;
      return {
        ...safeTournament,
        currentPlayers: _count.participants,
        isRegistered,
      };
    });

    return NextResponse.json({ tournaments: formattedTournaments });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch tournaments' }, { status: 500 });
  }
}

