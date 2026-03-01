import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => ({}));
    const token = String(body.token || '').trim();
    const platform = body.platform ? String(body.platform).trim() : null;
    const deviceId = body.deviceId ? String(body.deviceId).trim() : null;

    if (!token || token.length < 20) {
      return NextResponse.json({ error: 'Invalid push token' }, { status: 400 });
    }

    const saved = await prisma.userPushToken.upsert({
      where: { token },
      create: {
        userId: auth.user.id,
        token,
        platform,
        deviceId,
        isActive: true,
      },
      update: {
        userId: auth.user.id,
        platform,
        deviceId,
        isActive: true,
      },
      select: {
        id: true,
        token: true,
        platform: true,
        deviceId: true,
        isActive: true,
      },
    });

    return NextResponse.json({ token: saved });
  } catch (error) {
    console.error('Save push token error:', error);
    return NextResponse.json({ error: 'Failed to save push token' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => ({}));
    const token = String(body.token || '').trim();

    if (!token) {
      return NextResponse.json({ error: 'Push token is required' }, { status: 400 });
    }

    await prisma.userPushToken.updateMany({
      where: {
        userId: auth.user.id,
        token,
      },
      data: {
        isActive: false,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Deactivate push token error:', error);
    return NextResponse.json({ error: 'Failed to deactivate push token' }, { status: 500 });
  }
}
