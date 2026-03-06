import { NextRequest } from 'next/server';

import { requireAdminUser } from '@/lib/route-auth';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';
import { verifyResultSchema } from '@/lib/match-v1/validators';
import { reviewMatchResult } from '@/lib/match-v1/service';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireAdminUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const body = verifyResultSchema.parse(await req.json());
    const { id } = params;

    const outcome = await reviewMatchResult({
      matchId: id,
      reviewedBy: auth.user.id,
      action: body.action,
      winnerUserId: body.winnerUserId,
      note: body.note,
    });

    return ok({
      matchId: id,
      status: outcome.status,
      action: outcome.action,
      winnerUserId: outcome.winnerUserId,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
