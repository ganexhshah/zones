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

    const outcome = await submitResult({
      matchId: id,
      submittedBy: auth.user.id,
      resultChoice: body.resultChoice,
      hasScreenshot: body.hasScreenshot,
      note: body.note,
      reportReason: body.reportReason,
      reportDescription: body.reportDescription,
      proofUrl: body.proofUrl,
    });

    return ok({
      matchId: id,
      resultStatus: outcome.resultStatus,
      revealResults: outcome.revealResults,
      winnerUserId: outcome.winnerUserId,
      resultChoice: body.resultChoice,
      hasScreenshot: body.hasScreenshot,
      reportReason: body.reportReason ?? null,
      reportDescription: body.reportDescription ?? null,
      proofUrl: body.proofUrl ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
