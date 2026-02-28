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

    const match = await prisma.customMatch.findUnique({
      where: { id: params.id },
      select: { id: true, createdByUserId: true, status: true, maxPlayers: true },
    });
    if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    if (match.createdByUserId !== auth.user.id) {
      return NextResponse.json({ error: 'Only match creator can view requests' }, { status: 403 });
    }

    const requests = await prisma.customMatchJoinRequest.findMany({
      where: { customMatchId: match.id },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({ requests });
  } catch (error) {
    console.error('Custom match requests error:', error);
    return NextResponse.json({ error: 'Failed to fetch requests' }, { status: 500 });
  }
}
