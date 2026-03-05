import { NextRequest } from 'next/server';

import { requireAdminUser } from '@/lib/route-auth';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';
import { verifyResultSchema } from '@/lib/match-v1/validators';
import { verifyMatchAndPayout } from '@/lib/match-v1/service';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireAdminUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const body = verifyResultSchema.parse(await req.json());
    const { id } = params;

    await verifyMatchAndPayout({
      matchId: id,
      verifiedBy: auth.user.id,
      winnerUserId: body.winnerUserId,
    });

    return ok({
      matchId: id,
      status: 'COMPLETED',
      winnerUserId: body.winnerUserId,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
