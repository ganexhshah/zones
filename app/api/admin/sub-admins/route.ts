import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { ADMIN_PERMISSIONS, normalizePermissions } from '@/lib/admin-access';
import { requireAdminUser } from '@/lib/route-auth';

export const dynamic = 'force-dynamic';

function sanitizeSubAdmin(row: any) {
  return {
    id: row.id,
    userId: row.userId,
    email: row.user?.email || null,
    name: row.user?.name || null,
    isActive: Boolean(row.isActive),
    permissions: normalizePermissions(row.permissions),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy
      ? {
          id: row.createdBy.id,
          name: row.createdBy.name,
          email: row.createdBy.email,
        }
      : null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const access = (adminAuth as any).adminAccess;
    if (!access?.isMainAdmin) {
      return NextResponse.json({ error: 'Main admin access required' }, { status: 403 });
    }

    const subAdmins = await prisma.subAdmin.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, email: true, name: true } },
        createdBy: { select: { id: true, email: true, name: true } },
      },
    });

    return NextResponse.json({
      permissions: ADMIN_PERMISSIONS,
      subAdmins: subAdmins.map(sanitizeSubAdmin),
    });
  } catch (error) {
    console.error('Sub admin GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch sub admins' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const access = (adminAuth as any).adminAccess;
    if (!access?.isMainAdmin) {
      return NextResponse.json({ error: 'Main admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim();
    const password = String(body.password || '');
    const isActive = body.isActive == null ? true : Boolean(body.isActive);
    const permissions = normalizePermissions(body.permissions);

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }
    if (permissions.length === 0) {
      return NextResponse.json({ error: 'Select at least one permission' }, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json(
        {
          error:
            'Email already exists. Use a new email for sub admin creation or edit the existing sub admin account.',
        },
        { status: 409 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          name: name || email,
          password: await hashPassword(password),
          authProvider: 'email',
          isVerified: true,
        },
      });

      return tx.subAdmin.create({
        data: {
          userId: newUser.id,
          permissions,
          isActive,
          createdByUserId: adminAuth.user.id,
        },
        include: {
          user: { select: { id: true, email: true, name: true } },
          createdBy: { select: { id: true, email: true, name: true } },
        },
      });
    });

    return NextResponse.json({ subAdmin: sanitizeSubAdmin(result) });
  } catch (error) {
    console.error('Sub admin POST error:', error);
    return NextResponse.json({ error: 'Failed to create sub admin' }, { status: 500 });
  }
}
