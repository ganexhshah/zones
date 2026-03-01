import { NextRequest, NextResponse } from 'next/server';
import { requireAuthUser } from '@/lib/route-auth';
import { sendPushToUser } from '@/lib/push';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => ({}));
    const title = String(body.title || 'Test Notification').trim();
    const message = String(body.message || 'Push is working').trim();

    const result = await sendPushToUser(auth.user.id, {
      title,
      body: message,
      data: {
        type: 'test',
        status: 'completed',
      },
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('Push test error:', error);
    return NextResponse.json({ error: 'Failed to send test push' }, { status: 500 });
  }
}
