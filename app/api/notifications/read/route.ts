import { NextRequest, NextResponse } from 'next/server';
import { requireAuthUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const notificationId = typeof body.notificationId === 'string' ? body.notificationId.trim() : '';
    const markAll = body.markAll === true;
    const clearAll = body.clearAll === true;

    if (clearAll) {
      const deleted = await prisma.userNotification.deleteMany({
        where: { userId: auth.user.id },
      });
      return NextResponse.json({ success: true, deleted: deleted.count });
    }

    if (!markAll && !notificationId) {
      return NextResponse.json({ error: 'notificationId is required' }, { status: 400 });
    }

    if (markAll) {
      const updated = await prisma.userNotification.updateMany({
        where: { userId: auth.user.id, isRead: false },
        data: { isRead: true, readAt: new Date() },
      });
      return NextResponse.json({ success: true, updated: updated.count });
    }

    await prisma.userNotification.updateMany({
      where: { id: notificationId, userId: auth.user.id },
      data: { isRead: true, readAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Notification read error:', error);
    return NextResponse.json({ error: 'Failed to update notification read state' }, { status: 500 });
  }
}
