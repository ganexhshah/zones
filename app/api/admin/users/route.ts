import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get('limit') || '10', 10)),
    );
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          avatar: true,
          walletBalance: true,
          isVerified: true,
          isBlocked: true,
          blockReason: true,
          suspendedUntil: true,
          unblockRequestStatus: true,
          unblockRequestedAt: true,
          createdAt: true,
          pushTokens: {
            where: { isActive: true },
            select: {
              deviceId: true,
              updatedAt: true,
            },
            orderBy: { updatedAt: 'desc' },
            take: 1,
          },
          fraudFlags: {
            where: {
              ip: {
                not: null,
              },
            },
            select: {
              ip: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          _count: {
            select: {
              transactions: true,
              tournaments: true,
            },
          },
        },
      }),
      prisma.user.count(),
    ]);

    const normalizedUsers = users.map((user) => ({
      ...user,
      latestDeviceId: user.pushTokens[0]?.deviceId ?? null,
      latestKnownIp: user.fraudFlags[0]?.ip ?? null,
      latestDeviceSeenAt: user.pushTokens[0]?.updatedAt ?? null,
      latestIpSeenAt: user.fraudFlags[0]?.createdAt ?? null,
      pushTokens: undefined,
      fraudFlags: undefined,
    }));

    return NextResponse.json({
      users: normalizedUsers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get users error:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

