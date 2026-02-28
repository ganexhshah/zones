import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const matches = await prisma.customMatch.findMany({
      where: { createdByUserId: auth.user.id },
      include: {
        participants: {
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { slotNo: 'asc' },
        },
        joinRequests: {
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'asc' },
        },
        resultSubmissions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            winner: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ matches });
  } catch (error) {
    console.error('Created custom matches error:', error);
    return NextResponse.json({ error: 'Failed to fetch created matches' }, { status: 500 });
  }
}
