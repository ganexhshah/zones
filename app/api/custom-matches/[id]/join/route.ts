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

    const match = await prisma.customMatch.findUnique({
      where: { id: params.id },
      include: {
        participants: { select: { userId: true } },
      },
    });
    if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    if (match.createdByUserId === auth.user.id) {
      return NextResponse.json({ error: 'Creator already in match' }, { status: 400 });
    }
    if (match.participants.some((p) => p.userId === auth.user.id)) {
      return NextResponse.json({ error: 'Already joined' }, { status: 400 });
    }
    if (match.participants.length >= match.maxPlayers) {
      return NextResponse.json({ error: 'Match is full' }, { status: 400 });
    }

    const joinRequest = await prisma.customMatchJoinRequest.upsert({
      where: {
        customMatchId_userId: { customMatchId: match.id, userId: auth.user.id },
      },
      update: { status: 'PENDING', reviewedAt: null, reviewedByUserId: null },
      create: {
        customMatchId: match.id,
        userId: auth.user.id,
        status: 'PENDING',
      },
    });

    return NextResponse.json({ joinRequest });
  } catch (error) {
    console.error('Join custom match error:', error);
    return NextResponse.json({ error: 'Failed to send join request' }, { status: 500 });
  }
}
