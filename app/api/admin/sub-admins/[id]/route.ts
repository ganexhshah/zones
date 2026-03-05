import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { normalizePermissions } from '@/lib/admin-access';
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

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const access = (adminAuth as any).adminAccess;
    if (!access?.isMainAdmin) {
      return NextResponse.json({ error: 'Main admin access required' }, { status: 403 });
    }

    const { id } = await context.params;
    const body = await req.json().catch(() => ({}));
    const name = body.name == null ? null : String(body.name).trim();
    const password = body.password == null ? null : String(body.password);
    const isActive = body.isActive == null ? null : Boolean(body.isActive);
    const permissions =
      body.permissions == null ? null : normalizePermissions(body.permissions);

    const existing = await prisma.subAdmin.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Sub admin not found' }, { status: 404 });
    }

    if (permissions && permissions.length === 0) {
      return NextResponse.json({ error: 'Select at least one permission' }, { status: 400 });
    }
    if (password && password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (name != null || password) {
        await tx.user.update({
          where: { id: existing.userId },
          data: {
            ...(name != null ? { name } : {}),
            ...(password ? { password: await hashPassword(password) } : {}),
          },
        });
      }

      return tx.subAdmin.update({
        where: { id },
        data: {
          ...(permissions ? { permissions } : {}),
          ...(isActive != null ? { isActive } : {}),
        },
        include: {
          user: { select: { id: true, email: true, name: true } },
          createdBy: { select: { id: true, email: true, name: true } },
        },
      });
    });

    return NextResponse.json({ subAdmin: sanitizeSubAdmin(updated) });
  } catch (error) {
    console.error('Sub admin PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update sub admin' }, { status: 500 });
  }
}
