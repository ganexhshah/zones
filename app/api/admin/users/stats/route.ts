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

    // Get user growth for last 7 days (including zero-signup days).
    const startDay = new Date();
    startDay.setHours(0, 0, 0, 0);
    startDay.setDate(startDay.getDate() - 6);

    const userGrowthRaw = await prisma.$queryRaw<Array<{ date: string; users: number }>>`
      SELECT 
        TO_CHAR(DATE_TRUNC('day', "createdAt"), 'Mon DD') as date,
        COUNT(*)::int as users
      FROM "User"
      WHERE "createdAt" >= ${startDay}
      GROUP BY DATE_TRUNC('day', "createdAt")
      ORDER BY DATE_TRUNC('day', "createdAt") ASC
    `;

    const growthLookup = new Map(
      userGrowthRaw.map((row) => [row.date, Number(row.users || 0)])
    );
    const userGrowth = Array.from({ length: 7 }, (_, index) => {
      const d = new Date(startDay);
      d.setDate(startDay.getDate() + index);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
      return {
        date: label,
        users: growthLookup.get(label) ?? 0,
      };
    });

    // Non-overlapping user status distribution for accurate pie chart percentages.
    const activeVerified = await prisma.user.count({
      where: { isBlocked: false, isVerified: true },
    });
    const activeUnverified = await prisma.user.count({
      where: { isBlocked: false, isVerified: false },
    });
    const blockedVerified = await prisma.user.count({
      where: { isBlocked: true, isVerified: true },
    });
    const blockedUnverified = await prisma.user.count({
      where: { isBlocked: true, isVerified: false },
    });

    const usersByStatus = [
      { name: 'Active Verified', value: activeVerified, color: '#10b981' },
      { name: 'Active Unverified', value: activeUnverified, color: '#3b82f6' },
      { name: 'Blocked Verified', value: blockedVerified, color: '#f59e0b' },
      { name: 'Blocked Unverified', value: blockedUnverified, color: '#ef4444' },
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
      userGrowth,
      usersByStatus,
    });
  } catch (error) {
    console.error('Get user stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch user stats' }, { status: 500 });
  }
}

