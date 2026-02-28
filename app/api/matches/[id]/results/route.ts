import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));

    const match = await prisma.tournamentMatch.findUnique({
      where: { id: params.id },
      include: {
        tournament: true,
        participants: {
          include: {
            registration: {
              include: {
                team: { include: { members: true } },
              },
            },
          },
        },
      },
    });
    if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });

    const ownedParticipant = match.participants.find((p) => {
      const reg = p.registration;
      if (reg.userId && reg.userId === auth.user.id) return true;
      if (reg.team && reg.team.captainId === auth.user.id) return true;
      return false;
    });
    if (!ownedParticipant) {
      return NextResponse.json({ error: 'You are not a participant in this match' }, { status: 403 });
    }

    const proofUrl = typeof body.proofUrl === 'string' ? body.proofUrl.trim() : null;
    const placement = body.placement == null || body.placement === '' ? null : Number(body.placement);
    const kills = body.kills == null || body.kills === '' ? null : Number(body.kills);
    const roundWins = body.roundWins == null || body.roundWins === '' ? null : Number(body.roundWins);
    const roundLosses = body.roundLosses == null || body.roundLosses === '' ? null : Number(body.roundLosses);
    const score = body.score == null || body.score === '' ? null : Number(body.score);
    const scoreBreakdown = body.scoreBreakdown && typeof body.scoreBreakdown === 'object' ? body.scoreBreakdown : null;
    const proofMeta = body.proofMeta && typeof body.proofMeta === 'object' ? body.proofMeta : null;

    if ((match.tournament.proofRequired ?? true) && !proofUrl) {
      return NextResponse.json({ error: 'Proof URL is required' }, { status: 400 });
    }

    const existing = await prisma.matchResultSubmission.findFirst({
      where: {
        matchId: match.id,
        registrationId: ownedParticipant.registrationId,
      },
      orderBy: { createdAt: 'desc' },
    });

    let submission;
    if (existing && existing.verifiedStatus !== 'APPROVED') {
      submission = await prisma.matchResultSubmission.update({
        where: { id: existing.id },
        data: {
          proofUrl,
          proofMeta,
          placement,
          kills,
          roundWins,
          roundLosses,
          score,
          scoreBreakdown,
          verifiedStatus: 'PENDING',
          verifierNote: null,
          verifiedAt: null,
          verifiedByUserId: null,
          submittedByUserId: auth.user.id,
          submittedAt: new Date(),
        },
      });
    } else if (existing && existing.verifiedStatus === 'APPROVED') {
      return NextResponse.json({ error: 'Result already approved for this participant' }, { status: 400 });
    } else {
      submission = await prisma.matchResultSubmission.create({
        data: {
          matchId: match.id,
          registrationId: ownedParticipant.registrationId,
          submittedByUserId: auth.user.id,
          proofUrl,
          proofMeta,
          placement,
          kills,
          roundWins,
          roundLosses,
          score,
          scoreBreakdown,
        },
      });
    }

    return NextResponse.json({ submission });
  } catch (error) {
    console.error('Submit result error:', error);
    return NextResponse.json({ error: 'Failed to submit result' }, { status: 500 });
  }
}
