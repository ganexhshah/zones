import { NextRequest } from 'next/server';

import { requireAuthUser } from '@/lib/route-auth';
import { getMatchDetails } from '@/lib/match-v1/service';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const { id } = params;
    const match = await getMatchDetails(id, auth.user.id);
    if (!match) return fail('Match not found', 404);

    return ok({ match });
  } catch (error) {
    return handleApiError(error);
  }
}
