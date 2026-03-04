import { NextRequest } from 'next/server';

import { requireAuthUser } from '@/lib/route-auth';
import { acceptJoinRequestWithRoom, rejectJoinRequest } from '@/lib/match-v1/service';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';
import { reviewJoinRequestSchema } from '@/lib/match-v1/validators';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; requestId: string } },
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const body = reviewJoinRequestSchema.parse(await req.json());
    const { id: matchId } = params;

    if (body.action === 'accept') {
      if (!body.roomId || !body.roomPassword) {
        return fail('roomId and roomPassword are required when accepting', 400);
      }

      await acceptJoinRequestWithRoom({
        matchId,
        creatorId: auth.user.id,
        roomId: body.roomId,
        roomPassword: body.roomPassword,
      });

      return ok({
        matchId,
        status: 'CONFIRMED',
        joinRequestStatus: 'ACCEPTED',
        roomReady: true,
      });
    } else {
      await rejectJoinRequest({
        matchId,
        creatorId: auth.user.id,
      });

      return ok({
        matchId,
        status: 'OPEN',
        joinRequestStatus: 'REJECTED',
      });
    }
  } catch (error) {
    return handleApiError(error);
  }
}
