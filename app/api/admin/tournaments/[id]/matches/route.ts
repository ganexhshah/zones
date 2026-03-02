import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';
import { requireAuthPayload } from '@/lib/route-auth';
import { generateBrLeagueMatches, generateCsKnockoutBracket } from '@/lib/tournament-engine';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const auth = requireAuthPayload(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const matches = await prisma.tournamentMatch.findMany({
      where: { tournamentId: params.id },
      include: {
        participants: {
          include: {
            registration: {
              include: {
                user: { select: { id: true, name: true, email: true } },
                team: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: [{ roundNo: 'asc' }, { matchIndex: 'asc' }, { groupNo: 'asc' }, { createdAt: 'asc' }],
    });

    return NextResponse.json({
      matches: matches.map((m) => ({
        ...m,
        participants: m.participants.map((p) => ({
          id: p.id,
          slotNo: p.slotNo,
          joined: p.joined,
          isWinner: p.isWinner,
          score: p.score,
          placement: p.placement,
          kills: p.kills,
          registrationId: p.registrationId,
          participant: p.registration.team
            ? { type: 'team', id: p.registration.team.id, name: p.registration.team.name }
            : { type: 'user', id: p.registration.user?.id, name: p.registration.user?.name || p.registration.user?.email || 'Unknown' },
        })),
      })),
    });
  } catch (error) {
    console.error('Admin list matches error:', error);
    return NextResponse.json({ error: 'Failed to fetch matches' }, { status: 500 });
  }
}

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
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'generate').toLowerCase();
    if (action !== 'generate') {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }

    const tournament = await prisma.tournament.findUnique({ where: { id: params.id } });
    if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });

    const format = (tournament.format || 'BR_LEAGUE').toUpperCase();
    const roundNo = body.roundNo == null ? 1 : Number(body.roundNo);

    const result =
      format === 'CS_KNOCKOUT'
        ? await generateCsKnockoutBracket(params.id)
        : await generateBrLeagueMatches(params.id, roundNo);

    return NextResponse.json({ format, result });
  } catch (error: any) {
    console.error('Generate matches error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to generate matches' }, { status: 400 });
  }
}
