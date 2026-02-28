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

    const match = await prisma.tournamentMatch.findUnique({
      where: { id: params.id },
      include: {
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

    const isParticipant = match.participants.some((p) => {
      const r = p.registration;
      if (r.userId === auth.user.id) return true;
      return !!r.team?.members.some((m) => m.userId === auth.user.id && m.status === 'ACTIVE');
    });
    if (!isParticipant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const disputes = await prisma.tournamentDispute.findMany({
      where: { matchId: params.id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ disputes });
  } catch (error) {
    console.error('List disputes error:', error);
    return NextResponse.json({ error: 'Failed to fetch disputes' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const reason = String(body.reason || '').trim();
    const details = body.details ? String(body.details).trim() : null;
    const evidenceUrl = body.evidenceUrl ? String(body.evidenceUrl).trim() : null;

    if (!reason) return NextResponse.json({ error: 'Reason is required' }, { status: 400 });

    const match = await prisma.tournamentMatch.findUnique({
      where: { id: params.id },
      include: {
        participants: {
          include: {
            registration: { include: { team: { include: { members: true } } } },
          },
        },
      },
    });
    if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });

    const participant = match.participants.find((p) => {
      const r = p.registration;
      if (r.userId === auth.user.id) return true;
      return !!r.team?.members.some((m) => m.userId === auth.user.id && m.status === 'ACTIVE');
    });
    if (!participant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const dispute = await prisma.tournamentDispute.create({
      data: {
        tournamentId: match.tournamentId,
        matchId: match.id,
        registrationId: participant.registrationId,
        raisedByUserId: auth.user.id,
        reason,
        details,
        evidenceUrl,
      },
    });

    return NextResponse.json({ dispute }, { status: 201 });
  } catch (error) {
    console.error('Create dispute error:', error);
    return NextResponse.json({ error: 'Failed to create dispute' }, { status: 500 });
  }
}
