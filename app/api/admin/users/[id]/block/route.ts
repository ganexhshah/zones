import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const body = await req.json().catch(() => ({}));
    const reason = String(body?.reason || '').trim();
    const modeRaw = String(body?.mode || 'BLOCK').trim().toUpperCase();
    const mode = modeRaw === 'SUSPEND' ? 'SUSPEND' : 'BLOCK';
    const daysValue = Number(body?.days || 0);
    const days = Number.isFinite(daysValue) ? Math.max(0, Math.floor(daysValue)) : 0;

    if (!reason) {
      return NextResponse.json(
        { error: 'Reason is required to block/suspend user.' },
        { status: 400 },
      );
    }
    if (mode === 'SUSPEND' && days <= 0) {
      return NextResponse.json(
        { error: 'Suspension days must be greater than 0.' },
        { status: 400 },
      );
    }

    const suspendedUntil =
      mode === 'SUSPEND' && days > 0
        ? new Date(Date.now() + days * 24 * 60 * 60 * 1000)
        : null;

    const user = await prisma.user.update({
      where: { id: params.id },
      data: {
        isBlocked: true,
        blockReason: reason,
        suspendedUntil,
        unblockRequestStatus: 'NONE',
        unblockRequestMessage: null,
        unblockRequestedAt: null,
        unblockReviewNote: null,
        unblockReviewedAt: null,
      },
    });

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Block user error:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to block user';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
