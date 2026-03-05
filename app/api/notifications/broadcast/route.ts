import { NextRequest, NextResponse } from 'next/server';
import { requireAuthUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const notifications = await prisma.broadcastNotification.findMany({
      where: {
        target: 'ALL',
        OR: [
          { showAsPopup: false },
          { showAsPopup: true, allowDontShowAgain: false },
          {
            showAsPopup: true,
            allowDontShowAgain: true,
            popupDismissals: {
              none: {
                userId: auth.user.id,
              },
            },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        title: true,
        message: true,
        type: true,
        bannerImageUrl: true,
        showAsPopup: true,
        allowDontShowAgain: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ notifications });
  } catch (error) {
    console.error('Broadcast notifications GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }
}
