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
    const winnerUserId = String(body.winnerUserId || '').trim();
    const proofUrl = String(body.proofUrl || '').trim();
    if (!winnerUserId) return NextResponse.json({ error: 'winnerUserId is required' }, { status: 400 });
    if (!proofUrl) return NextResponse.json({ error: 'proofUrl is required' }, { status: 400 });

    const match = await prisma.customMatch.findUnique({
      where: { id: params.id },
      include: {
        participants: { select: { userId: true } },
      },
    });
    if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    if (match.createdByUserId !== auth.user.id) {
      return NextResponse.json({ error: 'Only creator can submit result' }, { status: 403 });
    }
    if (!match.participants.some((p) => p.userId === winnerUserId)) {
      return NextResponse.json({ error: 'Winner must be a match participant' }, { status: 400 });
    }

    const existing = await prisma.customMatchResultSubmission.findFirst({
      where: { customMatchId: match.id },
      orderBy: { createdAt: 'desc' },
    });

    let submission;
    if (existing && existing.status === 'PENDING') {
      submission = await prisma.customMatchResultSubmission.update({
        where: { id: existing.id },
        data: {
          winnerUserId,
          proofUrl,
          submittedByUserId: auth.user.id,
          status: 'PENDING',
          reviewerUserId: null,
          reviewedAt: null,
          reviewNote: null,
        },
      });
    } else {
      submission = await prisma.customMatchResultSubmission.create({
        data: {
          customMatchId: match.id,
          submittedByUserId: auth.user.id,
          winnerUserId,
          proofUrl,
          status: 'PENDING',
        },
      });
    }

    return NextResponse.json({ submission }, { status: 201 });
  } catch (error) {
    console.error('Custom match result submit error:', error);
    return NextResponse.json({ error: 'Failed to submit result' }, { status: 500 });
  }
}
