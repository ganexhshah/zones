import { NextRequest } from 'next/server';
import { requireAuthUser } from '@/lib/route-auth';
import { getCustomMatchOdds } from '@/lib/custom-odds';
import { fail, ok } from '@/lib/match-v1/http';

export async function GET(req: NextRequest) {
  const auth = await requireAuthUser(req);
  if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

  const odds = await getCustomMatchOdds();
  return ok({ odds });
}
