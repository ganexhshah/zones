import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthPayload } from '@/lib/route-auth';

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
    if (!['accept', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Action must be accept or reject' }, { status: 400 });
    }

    const submission = await prisma.customMatchResultSubmission.findUnique({
      where: { id: params.id },
      include: {
        customMatch: true,
        winner: true,
      },
    });
    if (!submission) return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    if (submission.status !== 'PENDING') {
      return NextResponse.json({ error: 'Submission already reviewed' }, { status: 400 });
    }

    const reviewed = await prisma.$transaction(async (tx) => {
      const updated = await tx.customMatchResultSubmission.update({
        where: { id: submission.id },
        data: {
          status: action === 'accept' ? 'APPROVED' : 'REJECTED',
          reviewerUserId: auth.payload.userId,
          reviewedAt: new Date(),
          reviewNote: note,
        },
      });

      if (action === 'accept') {
        const amount = Number((submission.customMatch.entryFee * 1.8).toFixed(2));
        await tx.user.update({
          where: { id: submission.winnerUserId },
          data: { walletBalance: { increment: amount } },
        });
        await tx.transaction.create({
          data: {
            userId: submission.winnerUserId,
            type: 'custom_match_win',
            amount,
            status: 'completed',
            method: 'wallet',
            reference: submission.customMatchId,
          },
        });
        await tx.customMatch.update({
          where: { id: submission.customMatchId },
          data: { status: 'CLOSED' },
        });
      }

      if (action === 'reject') {
        await tx.customMatch.update({
          where: { id: submission.customMatchId },
          data: { status: 'ACTIVE' },
        });
      }

      return updated;
    });

    return NextResponse.json({ submission: reviewed });
  } catch (error) {
    console.error('Admin custom result review error:', error);
    return NextResponse.json({ error: 'Failed to review submission' }, { status: 500 });
  }
}
