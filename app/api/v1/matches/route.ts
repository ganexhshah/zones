import { NextRequest } from 'next/server';

import { requireAuthUser } from '@/lib/route-auth';
import { createMatch, listMatches } from '@/lib/match-v1/service';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';
import { createMatchSchema, listMatchesSchema } from '@/lib/match-v1/validators';
import { toMatchResponse } from '@/lib/match-v1/serializers';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const input = createMatchSchema.parse(await req.json());

    const match = await createMatch({
      creatorId: auth.user.id,
      entryFee: input.entryFee,
      gameName: input.gameName,
      roomType: input.roomType,
      matchType: input.matchType,
      rounds: input.rounds,
      defaultCoin: input.defaultCoin,
      throwableLimit: input.throwableLimit,
      characterSkill: input.characterSkill,
      allSkillsAllowed: input.allSkillsAllowed,
      selectedSkills: input.selectedSkills,
      headshotOnly: input.headshotOnly,
      gunAttributes: input.gunAttributes,
      platformFeePercent: input.platformFeePercent,
    });

    return ok({ match: toMatchResponse(match) }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const query = listMatchesSchema.parse({
      status: req.nextUrl.searchParams.get('status'),
      limit: req.nextUrl.searchParams.get('limit') ?? 20,
    });

    const matches = await listMatches({
      status: query.status,
      limit: query.limit,
      requesterId: auth.user.id,
    });

    return ok({ matches: matches.map(toMatchResponse) });
  } catch (error) {
    return handleApiError(error);
  }
}

