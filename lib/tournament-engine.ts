import { prisma } from '@/lib/prisma';

type RegistrationLite = {
  id: string;
  seed: number | null;
  userId: string | null;
  teamId: string | null;
  user?: { id: string; name: string | null; email: string } | null;
  team?: { id: string; name: string; captainId: string } | null;
};

function shuffle<T>(arr: T[]) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function parseScoringConfig(scoringConfig: unknown) {
  const fallback = { placement: { '1': 12, '2': 9, '3': 8 }, killPoint: 1 };
  if (!scoringConfig) return fallback;
  if (typeof scoringConfig === 'object') return { ...fallback, ...(scoringConfig as Record<string, unknown>) };
  return fallback;
}

export function nextPowerOfTwo(n: number) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export async function getEligibleRegistrations(tournamentId: string) {
  const regs = await prisma.tournamentRegistration.findMany({
    where: {
      tournamentId,
      status: { in: ['APPROVED', 'CHECKED_IN'] },
      checkinStatus: { in: ['CHECKED_IN', 'PENDING'] },
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      team: { select: { id: true, name: true, captainId: true } },
    },
    orderBy: [{ seed: 'asc' }, { createdAt: 'asc' }],
  });

  const checkedIn = regs.filter((r) => r.checkinStatus === 'CHECKED_IN');
  return (checkedIn.length > 0 ? checkedIn : regs) as RegistrationLite[];
}

export async function generateBrLeagueMatches(tournamentId: string, roundNo = 1) {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament) throw new Error('Tournament not found');

  const existing = await prisma.tournamentMatch.count({ where: { tournamentId, roundNo } });
  if (existing > 0) throw new Error(`Round ${roundNo} matches already exist`);

  const regs = await getEligibleRegistrations(tournamentId);
  if (regs.length === 0) throw new Error('No eligible registrations found');

  const roomSize = tournament.roomSize || 48;
  const entrants = shuffle(regs);
  const chunks: RegistrationLite[][] = [];
  for (let i = 0; i < entrants.length; i += roomSize) {
    chunks.push(entrants.slice(i, i + roomSize));
  }

  return prisma.$transaction(async (tx) => {
    const matches = [];
    for (let i = 0; i < chunks.length; i++) {
      const match = await tx.tournamentMatch.create({
        data: {
          tournamentId,
          roundNo,
          groupNo: i + 1,
          status: 'SCHEDULED',
          formatSnapshot: 'BR_LEAGUE',
          metadata: { roomSize, generatedBy: 'system' },
          scheduledAt: tournament.startTime,
        },
      });

      await tx.tournamentMatchParticipant.createMany({
        data: chunks[i].map((reg, idx) => ({
          matchId: match.id,
          registrationId: reg.id,
          slotNo: idx + 1,
          seed: reg.seed ?? null,
        })),
      });
      matches.push(match);
    }
    return { matchesCreated: matches.length, roundNo, roomSize };
  });
}

export async function generateCsKnockoutBracket(tournamentId: string) {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament) throw new Error('Tournament not found');

  const existing = await prisma.tournamentMatch.count({ where: { tournamentId } });
  if (existing > 0) throw new Error('Matches already exist for this tournament');

  const regs = await getEligibleRegistrations(tournamentId);
  if (regs.length < 2) throw new Error('Need at least 2 eligible registrations');

  const entrants = [...regs].sort((a, b) => {
    const sa = a.seed ?? Number.MAX_SAFE_INTEGER;
    const sb = b.seed ?? Number.MAX_SAFE_INTEGER;
    return sa - sb;
  });

  const bracketSize = nextPowerOfTwo(entrants.length);
  const rounds = Math.log2(bracketSize);
  const slots: (RegistrationLite | null)[] = [...entrants];
  while (slots.length < bracketSize) slots.push(null);

  return prisma.$transaction(async (tx) => {
    const matchesByRound = new Map<number, { id: string; matchIndex: number }[]>();

    for (let roundNo = 1; roundNo <= rounds; roundNo++) {
      const count = bracketSize / 2 ** roundNo;
      const rows: { id: string; matchIndex: number }[] = [];
      for (let i = 1; i <= count; i++) {
        const m = await tx.tournamentMatch.create({
          data: {
            tournamentId,
            roundNo,
            matchIndex: i,
            status: 'SCHEDULED',
            formatSnapshot: 'CS_KNOCKOUT',
            scheduledAt: tournament.startTime,
            metadata: { bracketSize, rounds },
          },
          select: { id: true, matchIndex: true },
        });
        rows.push(m as { id: string; matchIndex: number });
      }
      matchesByRound.set(roundNo, rows);
    }

    const round1 = matchesByRound.get(1) || [];
    for (let i = 0; i < round1.length; i++) {
      const left = slots[i * 2];
      const right = slots[i * 2 + 1];
      const match = round1[i];

      const participants = [left, right].filter(Boolean) as RegistrationLite[];
      if (participants.length > 0) {
        await tx.tournamentMatchParticipant.createMany({
          data: participants.map((reg, idx) => ({
            matchId: match.id,
            registrationId: reg.id,
            slotNo: idx + 1,
            seed: reg.seed ?? null,
          })),
        });
      }

      if (left && !right) {
        await tx.tournamentMatch.update({
          where: { id: match.id },
          data: {
            status: 'FINISHED',
            metadata: { bracketSize, rounds, byeWinnerRegistrationId: left.id },
          },
        });
        await tx.tournamentMatchParticipant.updateMany({
          where: { matchId: match.id, registrationId: left.id },
          data: { isWinner: true, score: 1 },
        });
      }
      if (!left && right) {
        await tx.tournamentMatch.update({
          where: { id: match.id },
          data: {
            status: 'FINISHED',
            metadata: { bracketSize, rounds, byeWinnerRegistrationId: right.id },
          },
        });
        await tx.tournamentMatchParticipant.updateMany({
          where: { matchId: match.id, registrationId: right.id },
          data: { isWinner: true, score: 1 },
        });
      }
    }

    return { rounds, bracketSize, matchesCreated: [...matchesByRound.values()].reduce((n, r) => n + r.length, 0) };
  });
}

export async function propagateKnockoutWinner(matchId: string, winnerRegistrationId: string) {
  const match = await prisma.tournamentMatch.findUnique({
    where: { id: matchId },
    include: { tournament: true },
  });
  if (!match || (match.tournament.format || '').toUpperCase() !== 'CS_KNOCKOUT') return;
  if (!match.matchIndex) return;

  const nextRound = match.roundNo + 1;
  const nextMatchIndex = Math.ceil(match.matchIndex / 2);
  const nextSlot = match.matchIndex % 2 === 1 ? 1 : 2;

  const nextMatch = await prisma.tournamentMatch.findFirst({
    where: {
      tournamentId: match.tournamentId,
      roundNo: nextRound,
      matchIndex: nextMatchIndex,
    },
  });
  if (!nextMatch) return;

  await prisma.tournamentMatchParticipant.upsert({
    where: {
      matchId_registrationId: {
        matchId: nextMatch.id,
        registrationId: winnerRegistrationId,
      },
    },
    create: {
      matchId: nextMatch.id,
      registrationId: winnerRegistrationId,
      slotNo: nextSlot,
    },
    update: {
      slotNo: nextSlot,
    },
  });
}

export async function recalculateTournamentLeaderboard(tournamentId: string) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      registrations: {
        include: {
          user: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!tournament) throw new Error('Tournament not found');

  const approved = await prisma.matchResultSubmission.findMany({
    where: {
      verifiedStatus: 'APPROVED',
      match: { tournamentId },
    },
    include: {
      match: { select: { id: true } },
    },
    orderBy: { submittedAt: 'asc' },
  });

  const format = (tournament.format || 'BR_LEAGUE').toUpperCase();
  const scoring = parseScoringConfig(tournament.scoringConfig);
  const placementMap = (scoring as any).placement || {};
  const killPoint = Number((scoring as any).killPoint ?? 1);

  const byReg = new Map<string, {
    registrationId: string;
    points: number;
    kills: number;
    placementPoints: number;
    bonusPoints: number;
    matchesPlayed: number;
    wins: number;
  }>();

  for (const reg of tournament.registrations) {
    byReg.set(reg.id, {
      registrationId: reg.id,
      points: 0,
      kills: 0,
      placementPoints: 0,
      bonusPoints: 0,
      matchesPlayed: 0,
      wins: 0,
    });
  }

  for (const s of approved) {
    const entry = byReg.get(s.registrationId);
    if (!entry) continue;
    entry.matchesPlayed += 1;

    if (format === 'BR_LEAGUE') {
      const placementPoints = s.placement ? Number(placementMap[String(s.placement)] ?? 0) : 0;
      const kills = s.kills || 0;
      const bonus = typeof (s.scoreBreakdown as any)?.bonusPoints === 'number'
        ? Number((s.scoreBreakdown as any).bonusPoints)
        : 0;
      const score = placementPoints + kills * killPoint + bonus;
      entry.kills += kills;
      entry.placementPoints += placementPoints;
      entry.bonusPoints += bonus;
      entry.points += score;
      if (s.placement === 1) entry.wins += 1;
    } else {
      const isWinner =
        typeof (s.scoreBreakdown as any)?.isWinner === 'boolean'
          ? Boolean((s.scoreBreakdown as any).isWinner)
          : (s.roundWins || 0) > (s.roundLosses || 0);
      if (isWinner) {
        entry.wins += 1;
        entry.points += 1;
      }
      entry.kills += s.kills || 0;
    }
  }

  const ranked = [...byReg.values()].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.kills !== a.kills) return b.kills - a.kills;
    return a.registrationId.localeCompare(b.registrationId);
  });

  await prisma.$transaction(async (tx) => {
    await tx.tournamentLeaderboardEntry.deleteMany({ where: { tournamentId } });
    if (ranked.length === 0) return;

    await tx.tournamentLeaderboardEntry.createMany({
      data: ranked.map((e, i) => ({
        tournamentId,
        registrationId: e.registrationId,
        rank: i + 1,
        points: e.points,
        kills: e.kills,
        placementPoints: e.placementPoints,
        bonusPoints: e.bonusPoints,
        matchesPlayed: e.matchesPlayed,
        wins: e.wins,
        lastCalculatedAt: new Date(),
      })),
    });
  });

  return { totalEntries: ranked.length, format };
}
