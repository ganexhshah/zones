import { NextRequest } from 'next/server';

import { requireAuthUser } from '@/lib/route-auth';
import { listChatMessages, sendChatMessage } from '@/lib/match-v1/service';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';
import { rateLimit } from '@/lib/match-v1/redis-guards';
import { sendChatSchema } from '@/lib/match-v1/validators';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const { id } = params;
    const cursor = req.nextUrl.searchParams.get('cursor') ?? undefined;
    const limit = Number(req.nextUrl.searchParams.get('limit') ?? 30);

    const messages = await listChatMessages({
      matchId: id,
      requesterId: auth.user.id,
      cursor,
      limit,
    });

    return ok({
      messages: messages.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        message: m.message,
        createdAt: m.createdAt,
      })),
      nextCursor: messages.length ? messages[messages.length - 1].id : null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const limiter = await rateLimit(`rl:chat:${auth.user.id}`, 30, 60);
    if (!limiter.allowed) return fail('Too many chat messages', 429);

    const body = sendChatSchema.parse(await req.json());
    const { id } = params;

    const message = await sendChatMessage({
      matchId: id,
      senderId: auth.user.id,
      message: body.message,
    });

    return ok({
      message: {
        id: message.id,
        senderId: message.senderId,
        message: message.message,
        createdAt: message.createdAt,
      },
    }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
