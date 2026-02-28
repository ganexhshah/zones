import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthPayload } from '@/lib/route-auth';
import { propagateKnockoutWinner, recalculateTournamentLeaderboard } from '@/lib/tournament-engine';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuthPayload(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').toLowerCase();
    const note = typeof body.note === 'string' ? body.note.trim() : null;

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Action must be approve or reject' }, { status: 400 });
    }

    const submission = await prisma.matchResultSubmission.findUnique({
      where: { id: params.id },
      include: {
        match: { include: { tournament: true, participants: true } },
        registration: true,
      },
    });
    if (!submission) return NextResponse.json({ error: 'Result submission not found' }, { status: 404 });

    const updated = await prisma.matchResultSubmission.update({
      where: { id: submission.id },
      data: {
        verifiedStatus: action === 'approve' ? 'APPROVED' : 'REJECTED',
        verifiedAt: new Date(),
        verifiedByUserId: auth.payload.userId,
        verifierNote: note,
      },
    });

    if (action === 'approve') {
      await prisma.tournamentMatchParticipant.updateMany({
        where: { matchId: submission.matchId, registrationId: submission.registrationId },
        data: {
          placement: submission.placement ?? undefined,
          kills: submission.kills ?? undefined,
          score: submission.score ?? undefined,
        },
      });

      const isCs = (submission.match.tournament.format || '').toUpperCase() === 'CS_KNOCKOUT';
      if (isCs) {
        const isWinner =
          typeof (submission.scoreBreakdown as any)?.isWinner === 'boolean'
            ? Boolean((submission.scoreBreakdown as any).isWinner)
            : (submission.roundWins || 0) > (submission.roundLosses || 0);

        if (isWinner) {
          await prisma.tournamentMatchParticipant.updateMany({
            where: { matchId: submission.matchId },
            data: { isWinner: false },
          });
          await prisma.tournamentMatchParticipant.updateMany({
            where: { matchId: submission.matchId, registrationId: submission.registrationId },
            data: { isWinner: true },
          });
          await prisma.tournamentMatch.update({
            where: { id: submission.matchId },
            data: { status: 'FINISHED' },
          });
          await propagateKnockoutWinner(submission.matchId, submission.registrationId);
        }
      }

      if (body.recalculateLeaderboard !== false) {
        await recalculateTournamentLeaderboard(submission.match.tournamentId);
      }
    }

    return NextResponse.json({ submission: updated });
  } catch (error) {
    console.error('Verify result error:', error);
    return NextResponse.json({ error: 'Failed to verify result' }, { status: 500 });
  }
}
