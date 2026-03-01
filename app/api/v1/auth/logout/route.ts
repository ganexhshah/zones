import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';
import { hashToken } from '@/lib/match-v1/auth-tokens';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const refreshToken = body.refreshToken as string | undefined;
    if (!refreshToken) return fail('refreshToken is required', 400);

    await prisma.refreshToken.updateMany({
      where: {
        tokenHash: hashToken(refreshToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    return ok({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

