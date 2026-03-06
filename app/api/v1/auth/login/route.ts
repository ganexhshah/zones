import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/auth';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';
import { rateLimit } from '@/lib/match-v1/redis-guards';
import { loginSchema } from '@/lib/match-v1/validators';
import { hashToken, signAccessToken, signRefreshToken } from '@/lib/match-v1/auth-tokens';
import { resolveAccountRestriction } from '@/lib/account-status';

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'anon';
    const limiter = await rateLimit(`rl:auth:login:${ip}`, 20, 60);
    if (!limiter.allowed) return fail('Too many requests', 429);

    const payload = loginSchema.parse(await req.json());

    const user = await prisma.user.findFirst({
      where: payload.email ? { email: payload.email } : { phone: payload.phone },
    });

    if (!user) return fail('Invalid credentials', 401);

    const hash = user.passwordHash ?? user.password;
    if (!hash) return fail('Invalid credentials', 401);

    const valid = await verifyPassword(payload.password, hash);
    if (!valid) return fail('Invalid credentials', 401);

    const restriction = await resolveAccountRestriction(user);
    if (restriction) {
      return fail(
        restriction.status === 'SUSPENDED' ? 'Account suspended' : 'Account blocked',
        403,
      );
    }

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
    });
  } catch (error) {
    return handleApiError(error);
  }
}

