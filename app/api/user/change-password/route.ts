import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword, hashPassword } from '@/lib/auth';
import { requireAuthUser } from '@/lib/route-auth';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { currentPassword, newPassword } = await req.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: auth.user.id },
    });

    const hash = user?.passwordHash ?? user?.password;
    if (!user || !hash) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const isValid = await verifyPassword(currentPassword, hash);
    if (!isValid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }

    const hashedPassword = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: auth.user.id },
      data: {
        password: hashedPassword,
        passwordHash: hashedPassword,
      },
    });

    return NextResponse.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 });
  }
}
