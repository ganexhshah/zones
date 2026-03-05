import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function DELETE(
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

    const exists = await prisma.broadcastNotification.findUnique({ where: { id } });
    if (!exists) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    }

    const deletedUserRows = await prisma.userNotification.deleteMany({
      where: {
        metadata: {
          path: ['broadcastId'],
          equals: id,
        },
      },
    });

    await prisma.broadcastNotification.delete({ where: { id } });

    return NextResponse.json({
      success: true,
      deletedNotificationId: id,
      deletedUserNotifications: deletedUserRows.count,
    });
  } catch (error) {
    console.error('Delete broadcast notification error:', error);
    return NextResponse.json(
      { error: 'Failed to delete broadcast notification' },
      { status: 500 },
    );
  }
}
