import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = String(body?.email || '').trim().toLowerCase();
    const message = String(body?.message || '').trim();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        isBlocked: true,
        suspendedUntil: true,
      },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (!user.isBlocked) {
      return NextResponse.json(
        { error: 'This account is not blocked or suspended.' },
        { status: 400 },
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        unblockRequestStatus: 'PENDING',
        unblockRequestMessage: message || null,
        unblockRequestedAt: new Date(),
        unblockReviewNote: null,
        unblockReviewedAt: null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unblock request error:', error);
    return NextResponse.json(
      { error: 'Failed to submit unblock request' },
      { status: 500 },
    );
  }
}
