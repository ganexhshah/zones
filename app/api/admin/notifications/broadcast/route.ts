import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';
import { cloudinary } from '@/lib/cloudinary';
import { sendPushToAllUsers } from '@/lib/push';
import { createNotificationForAllUsers } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json(
        { error: adminAuth.error },
        { status: adminAuth.status },
      );
    }

    const items = await prisma.broadcastNotification.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return NextResponse.json({ notifications: items });
  } catch (error) {
    console.error('Admin broadcast list error:', error);
    return NextResponse.json({ error: 'Failed to fetch broadcast notifications' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json(
        { error: adminAuth.error },
        { status: adminAuth.status },
      );
    }

    const formData = await req.formData();
    const title = String(formData.get('title') || '').trim();
    const message = String(formData.get('message') || '').trim();
    const rawType = String(formData.get('type') || 'NORMAL').trim().toUpperCase();
    const type = rawType === 'BANNER' ? 'BANNER' : 'NORMAL';
    const bannerFile = formData.get('banner') as File | null;

    if (!title || !message) {
      return NextResponse.json({ error: 'Title and message are required' }, { status: 400 });
    }

    let bannerImageUrl: string | null = null;
    if (type === 'BANNER') {
      if (!bannerFile) {
        return NextResponse.json({ error: 'Banner image is required for banner type' }, { status: 400 });
      }
      const bytes = await bannerFile.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const base64 = buffer.toString('base64');
      const dataURI = `data:${bannerFile.type};base64,${base64}`;
      const uploaded = await cloudinary.uploader.upload(dataURI, {
        folder: 'notification_banners',
      });
      bannerImageUrl = uploaded.secure_url;
    }

    const record = await prisma.broadcastNotification.create({
      data: {
        title,
        message,
        type,
        bannerImageUrl,
        target: 'ALL',
        createdByUserId: adminAuth.user.id,
      },
    });

    const stored = await createNotificationForAllUsers({
      category: 'BROADCAST',
      title,
      message,
      imageUrl: bannerImageUrl,
      metadata: {
        broadcastId: record.id,
        type,
      },
    });

    const pushResult = await sendPushToAllUsers({
      title,
      body: message,
      imageUrl: bannerImageUrl || undefined,
      data: {
        type: 'broadcast',
        notificationType: type.toLowerCase(),
        notificationId: record.id,
      },
    });

    return NextResponse.json({ notification: record, pushResult, stored });
  } catch (error) {
    console.error('Admin broadcast send error:', error);
    return NextResponse.json({ error: 'Failed to send broadcast notification' }, { status: 500 });
  }
}
