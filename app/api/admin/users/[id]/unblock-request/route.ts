import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json(
        { error: adminAuth.error },
        { status: adminAuth.status },
      );
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '').trim().toUpperCase();
    const note = String(body?.note || '').trim();

    if (action !== 'APPROVE' && action !== 'REJECT') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const user = await prisma.user.update({
      where: { id: params.id },
      data:
        action === 'APPROVE'
          ? {
              isBlocked: false,
              blockReason: null,
              suspendedUntil: null,
              unblockRequestStatus: 'APPROVED',
              unblockReviewNote: note || 'Approved by admin.',
              unblockReviewedAt: new Date(),
            }
          : {
              unblockRequestStatus: 'REJECTED',
              unblockReviewNote: note || 'Rejected by admin.',
              unblockReviewedAt: new Date(),
            },
      select: {
        id: true,
        isBlocked: true,
        blockReason: true,
        suspendedUntil: true,
        unblockRequestStatus: true,
        unblockReviewNote: true,
        unblockReviewedAt: true,
      },
    });

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Review unblock request error:', error);
    return NextResponse.json(
      { error: 'Failed to review unblock request' },
      { status: 500 },
    );
  }
}
