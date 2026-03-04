import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get total counts
    const [totalUsers, activeUsers, verifiedUsers, blockedUsers, lastDaySignups, recentSignupsRaw] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isBlocked: false } }),
      prisma.user.count({ where: { isVerified: true } }),
      prisma.user.count({ where: { isBlocked: true } }),
      prisma.user.count({ where: { createdAt: { gte: last24Hours } } }),
      prisma.user.findMany({
        where: { createdAt: { gte: last24Hours } },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
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
        },
      }),
    ]);

    // Get user growth for last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const userGrowth = await prisma.$queryRaw<Array<{ date: string; users: number }>>`
      SELECT 
        TO_CHAR(DATE_TRUNC('day', "createdAt"), 'Mon DD') as date,
        COUNT(*)::int as users
      FROM "User"
      WHERE "createdAt" >= ${sevenDaysAgo}
      GROUP BY DATE_TRUNC('day', "createdAt")
      ORDER BY DATE_TRUNC('day', "createdAt") ASC
    `;

    // User status distribution
    const usersByStatus = [
      { name: 'Active', value: activeUsers, color: '#10b981' },
      { name: 'Verified', value: verifiedUsers, color: '#3b82f6' },
      { name: 'Unverified', value: totalUsers - verifiedUsers, color: '#f59e0b' },
      { name: 'Blocked', value: blockedUsers, color: '#ef4444' },
    ];

    const recentSignups = recentSignupsRaw.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      createdAt: user.createdAt,
      latestDeviceId: user.pushTokens[0]?.deviceId ?? null,
      latestDeviceSeenAt: user.pushTokens[0]?.updatedAt ?? null,
      latestKnownIp: user.fraudFlags[0]?.ip ?? null,
      latestIpSeenAt: user.fraudFlags[0]?.createdAt ?? null,
    }));

    return NextResponse.json({
      totalUsers,
      activeUsers,
      verifiedUsers,
      blockedUsers,
      lastDaySignups,
      recentSignups,
      userGrowth: userGrowth.length > 0 ? userGrowth : [
        { date: 'Mon 01', users: 0 },
        { date: 'Tue 02', users: 0 },
        { date: 'Wed 03', users: 0 },
        { date: 'Thu 04', users: 0 },
        { date: 'Fri 05', users: 0 },
        { date: 'Sat 06', users: 0 },
        { date: 'Sun 07', users: 0 },
      ],
      usersByStatus,
    });
  } catch (error) {
    console.error('Get user stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch user stats' }, { status: 500 });
  }
}
