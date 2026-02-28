import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const matches = await prisma.customMatch.findMany({
      where: {
        OR: [
          { createdByUserId: auth.user.id },
          { participants: { some: { userId: auth.user.id } } },
        ],
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        participants: { include: { user: { select: { id: true, name: true } } } },
        resultSubmissions: {
          include: {
            winner: { select: { id: true, name: true } },
            submittedBy: { select: { id: true, name: true } },
            reviewer: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ matches });
  } catch (error) {
    console.error('Custom match history error:', error);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}
