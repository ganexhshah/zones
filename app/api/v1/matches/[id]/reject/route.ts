import { NextRequest } from 'next/server';

import { requireAuthUser } from '@/lib/route-auth';
import { rejectJoinRequest } from '@/lib/match-v1/service';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const { id } = params;
    await rejectJoinRequest({ matchId: id, creatorId: auth.user.id });
    return ok({ matchId: id, status: 'OPEN', joinRequestStatus: 'REJECTED' });
  } catch (error) {
    return handleApiError(error);
  }
}
