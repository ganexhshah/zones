import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';
import { sendPushToAllUsers } from '@/lib/push';
import { createNotificationForAllUsers } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json(
        { error: adminAuth.error },
        { status: adminAuth.status },
      );
    }

    const id = params.id;
    if (!id) {
      return NextResponse.json({ error: 'Notification id is required' }, { status: 400 });
    }

    const broadcast = await prisma.broadcastNotification.findUnique({
      where: { id },
    });
    if (!broadcast) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    }

    const stored = await createNotificationForAllUsers({
      category: 'BROADCAST',
      title: broadcast.title,
      message: broadcast.message,
      imageUrl: broadcast.bannerImageUrl,
      metadata: {
        broadcastId: broadcast.id,
        type: broadcast.type,
        showAsPopup: broadcast.showAsPopup,
        allowDontShowAgain: broadcast.allowDontShowAgain,
        resent: true,
      },
    });

    const pushResult = await sendPushToAllUsers({
      title: broadcast.title,
      body: broadcast.message,
      imageUrl: broadcast.bannerImageUrl || undefined,
      data: {
        type: 'broadcast',
        notificationType: broadcast.type.toLowerCase(),
        notificationId: broadcast.id,
        resent: 'true',
      },
    });

    await prisma.broadcastNotification.update({
      where: { id: broadcast.id },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      notificationId: broadcast.id,
      stored,
      pushResult,
    });
  } catch (error) {
    console.error('Resend broadcast notification error:', error);
    return NextResponse.json(
      { error: 'Failed to resend notification' },
      { status: 500 },
    );
  }
}
