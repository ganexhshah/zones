import { NextRequest } from 'next/server';

import { requireAuthUser } from '@/lib/route-auth';
import { submitResult } from '@/lib/match-v1/service';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';
import { submitResultSchema } from '@/lib/match-v1/validators';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const body = submitResultSchema.parse(await req.json());
    const { id } = params;

    await submitResult({
      matchId: id,
      submittedBy: auth.user.id,
      winnerUserId: body.winnerUserId,
      note: body.note,
      proofUrl: body.proofUrl,
    });

    return ok({
      matchId: id,
      resultStatus: 'SUBMITTED_FOR_VERIFICATION',
      winnerUserId: body.winnerUserId,
      proofUrl: body.proofUrl ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
