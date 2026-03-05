import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword, generateToken } from '@/lib/auth';
import { resolveAccountRestriction } from '@/lib/account-status';
import { resolveAdminAccessForUser } from '@/lib/admin-access';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

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
    return NextResponse.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
      adminAccess,
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
