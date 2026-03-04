import { NextRequest, NextResponse } from 'next/server';
import { requireAuthUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get('unreadOnly') === '1';
    const take = Math.min(Number(searchParams.get('take') || 50), 100);

    const notifications = await prisma.userNotification.findMany({
      where: {
        userId: auth.user.id,
        ...(unreadOnly ? { isRead: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        category: true,
        title: true,
        message: true,
        metadata: true,
        imageUrl: true,
        isRead: true,
        readAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ notifications });
  } catch (error) {
    console.error('Notifications list error:', error);
    console.error('Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }
}
