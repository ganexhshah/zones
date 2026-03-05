import { NextRequest, NextResponse } from 'next/server';
import { requireAuthUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => ({}));
    const broadcastId = String(body?.broadcastId || '').trim();
    if (!broadcastId) {
      return NextResponse.json({ error: 'broadcastId is required' }, { status: 400 });
    }

    const broadcast = await prisma.broadcastNotification.findUnique({
      where: { id: broadcastId },
      select: { id: true, showAsPopup: true, allowDontShowAgain: true },
    });
    if (!broadcast) {
      return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 });
    }
    if (!broadcast.showAsPopup || !broadcast.allowDontShowAgain) {
      return NextResponse.json({ success: true, ignored: true });
    }

    await prisma.broadcastPopupDismissal.upsert({
      where: {
        userId_broadcastId: {
          userId: auth.user.id,
          broadcastId: broadcast.id,
        },
      },
      create: {
        userId: auth.user.id,
        broadcastId: broadcast.id,
      },
      update: {
        createdAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Dismiss popup broadcast error:', error);
    return NextResponse.json({ error: 'Failed to dismiss popup' }, { status: 500 });
  }
}
