import { NextRequest } from 'next/server';

import { requireAuthUser } from '@/lib/route-auth';
import { getMatchLedger } from '@/lib/match-v1/service';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const { id } = params;
    const ledger = await getMatchLedger(id, auth.user.id);

    return ok({
      matchId: id,
      ledger: ledger.map((row) => ({
        id: row.id,
        userId: row.userId,
        type: row.type,
        amount: Number(row.amount),
        balanceAfter: Number(row.balanceAfter),
        createdAt: row.createdAt,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
