import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword, generateToken } from '@/lib/auth';
import { resolveAccountRestriction } from '@/lib/account-status';
import { resolveAdminAccessForUser } from '@/lib/admin-access';
import { rateLimit } from '@/lib/match-v1/redis-guards';

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'anon';
    const limiter = await rateLimit(`rl:auth:legacy-login:${ip}`, 20, 60);
    if (!limiter.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const restriction = await resolveAccountRestriction(user);
    if (restriction) {
      return NextResponse.json(
        {
          error:
            restriction.status === 'SUSPENDED'
              ? 'Account suspended'
              : 'Account blocked',
          accountStatus: restriction,
        },
        { status: 403 },
      );
    }

    const adminAccess = await resolveAdminAccessForUser({
      id: user.id,
      email: user.email,
    });
    const token = generateToken(user.id, {
      isAdmin: Boolean(adminAccess?.isAdmin),
      isMainAdmin: Boolean(adminAccess?.isMainAdmin),
      permissions: adminAccess?.permissions || [],
    });
    const response = NextResponse.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
      adminAccess,
    });
    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
