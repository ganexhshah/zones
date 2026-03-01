import { NextRequest } from 'next/server';

import { requireAuthUser } from '@/lib/route-auth';
import { acquireMatchLock, rateLimit, releaseMatchLock } from '@/lib/match-v1/redis-guards';
import { joinMatch } from '@/lib/match-v1/service';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id: matchId } = params;
  const lock = await acquireMatchLock(matchId, 8000);
  if (!lock.acquired) return fail('Match is busy, retry in a moment', 409);

  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const limiter = await rateLimit(`rl:join:${auth.user.id}`, 15, 60);
    if (!limiter.allowed) return fail('Too many join attempts', 429);

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const result = await joinMatch({
      matchId,
      joinerId: auth.user.id,
      ip,
    });

    return ok({
      matchId,
      status: result.updatedMatch.status,
      joinRequestStatus: result.joinRequest.status,
      expiresAt: result.updatedMatch.expiresAt,
    });
  } catch (error) {
    console.error('v1 join error:', error);
    return handleApiError(error);
  } finally {
    await releaseMatchLock(lock.key);
  }
}
