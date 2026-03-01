import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';
import { hashToken, signAccessToken, signRefreshToken, verifyRefreshToken } from '@/lib/match-v1/auth-tokens';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const refreshToken = body.refreshToken as string | undefined;
    if (!refreshToken) return fail('refreshToken is required', 400);

    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) return fail('Invalid refresh token', 401);

    const tokenHash = hashToken(refreshToken);
    const stored = await prisma.refreshToken.findFirst({
      where: {
        userId: decoded.userId,
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!stored) return fail('Refresh token not found or expired', 401);

    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const nextAccessToken = signAccessToken(decoded.userId);
    const nextRefreshToken = signRefreshToken(decoded.userId);

    await prisma.refreshToken.create({
      data: {
        userId: decoded.userId,
        tokenHash: hashToken(nextRefreshToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    return ok({
      accessToken: nextAccessToken,
      refreshToken: nextRefreshToken,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

