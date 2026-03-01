import { NextRequest } from 'next/server';

import { requireAuthUser } from '@/lib/route-auth';
import { acceptJoinRequest } from '@/lib/match-v1/service';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const { id } = params;
    await acceptJoinRequest({ matchId: id, creatorId: auth.user.id });
    return ok({ matchId: id, status: 'CONFIRMED', joinRequestStatus: 'ACCEPTED' });
  } catch (error) {
    return handleApiError(error);
  }
}
