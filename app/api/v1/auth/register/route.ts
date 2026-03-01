import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';
import { rateLimit } from '@/lib/match-v1/redis-guards';
import { registerSchema } from '@/lib/match-v1/validators';
import { hashToken, signAccessToken, signRefreshToken } from '@/lib/match-v1/auth-tokens';

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'anon';
    const limiter = await rateLimit(`rl:auth:register:${ip}`, 10, 60);
    if (!limiter.allowed) return fail('Too many requests', 429);

    const payload = registerSchema.parse(await req.json());

    const hash = await hashPassword(payload.password);
    const user = await prisma.user.create({
      data: {
        email: payload.email ?? `${Date.now()}@placeholder.local`,
        phone: payload.phone,
        name: payload.name,
        password: hash,
        passwordHash: hash,
        availableBalance: 0,
        lockedBalance: 0,
        walletBalance: 0,
      },
    });

    const accessToken = signAccessToken(user.id);
    const refreshToken = signRefreshToken(user.id);

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    return ok({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        name: user.name,
      },
    }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

