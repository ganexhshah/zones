import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Get total counts
    const [totalUsers, activeUsers, verifiedUsers, blockedUsers] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isBlocked: false } }),
      prisma.user.count({ where: { isVerified: true } }),
      prisma.user.count({ where: { isBlocked: true } }),
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

    return NextResponse.json({
      totalUsers,
      activeUsers,
      verifiedUsers,
      blockedUsers,
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
