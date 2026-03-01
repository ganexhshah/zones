import { NextRequest } from 'next/server';

import { requireAuthUser } from '@/lib/route-auth';
import { submitRoom } from '@/lib/match-v1/service';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';
import { submitRoomSchema } from '@/lib/match-v1/validators';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const body = submitRoomSchema.parse(await req.json());
    const { id } = params;
    await submitRoom({
      matchId: id,
      creatorId: auth.user.id,
      roomId: body.roomId,
      roomPassword: body.roomPassword,
    });

    return ok({
      matchId: id,
      status: 'CONFIRMED',
      roomReady: true,
      roomIdMasked: `${body.roomId.slice(0, 2)}***${body.roomId.slice(-2)}`,
      roomPasswordMasked: `${body.roomPassword.slice(0, 2)}***${body.roomPassword.slice(-2)}`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
