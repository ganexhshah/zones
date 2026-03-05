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

    const user = await prisma.user.update({
      where: { id: params.id },
      data: {
        isBlocked: false,
        blockReason: null,
        suspendedUntil: null,
        unblockRequestStatus: 'APPROVED',
        unblockReviewNote: 'Approved by admin and account unblocked.',
        unblockReviewedAt: new Date(),
      },
    });

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Unblock user error:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to unblock user';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
