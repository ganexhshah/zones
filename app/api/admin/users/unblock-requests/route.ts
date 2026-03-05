import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json(
        { error: adminAuth.error },
        { status: adminAuth.status },
      );
    }

    const requests = await prisma.user.findMany({
      where: { unblockRequestStatus: 'PENDING' },
      orderBy: { unblockRequestedAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        isBlocked: true,
        blockReason: true,
        suspendedUntil: true,
        unblockRequestMessage: true,
        unblockRequestedAt: true,
      },
      take: 200,
    });

    return NextResponse.json({ requests });
  } catch (error) {
    console.error('List unblock requests error:', error);
    return NextResponse.json(
      { error: 'Failed to load unblock requests' },
      { status: 500 },
    );
  }
}
