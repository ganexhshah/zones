import { NextRequest } from 'next/server';

import { requireAuthUser } from '@/lib/route-auth';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';
import { reportMatchSchema } from '@/lib/match-v1/validators';
import { reportMatchIssue } from '@/lib/match-v1/service';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const body = reportMatchSchema.parse(await req.json());
    const { id } = params;

    await reportMatchIssue({
      matchId: id,
      reportedBy: auth.user.id,
      reason: body.reason,
      details: body.details,
      proofUrl: body.proofUrl,
    });

    return ok({
      matchId: id,
      reportStatus: 'SUBMITTED',
    });
  } catch (error) {
    return handleApiError(error);
  }
}

