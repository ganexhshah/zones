import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/match-v1/redis-guards';
import { resolveAccountRestriction } from '@/lib/account-status';

const GENERIC_SUCCESS_RESPONSE = {
  success: true,
  message: 'If your account is eligible, the unblock request has been submitted.',
};

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'anon';
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || '').trim().toLowerCase();
    const message = String(body?.message || '').trim();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const ipLimiter = await rateLimit(`rl:auth:unblock:ip:${ip}`, 10, 300);
    if (!ipLimiter.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
    const emailLimiter = await rateLimit(`rl:auth:unblock:email:${email}`, 3, 3600);
    if (!emailLimiter.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        isBlocked: true,
        blockReason: true,
        suspendedUntil: true,
      },
    });

    if (user) {
      const restriction = await resolveAccountRestriction(user);
      if (restriction) {
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
      }
    }

    return NextResponse.json(GENERIC_SUCCESS_RESPONSE);
  } catch (error) {
    console.error('Unblock request error:', error);
    return NextResponse.json(
      { error: 'Failed to submit unblock request' },
      { status: 500 },
    );
  }
}
