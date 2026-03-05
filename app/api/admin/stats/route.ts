import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { getSystemSettings } from '@/lib/system-settings';

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

    // Get stats
    const [
      totalUsers,
      pendingTransactions,
      totalRevenue,
      totalWithdrawals,
      userBalanceAggregate,
      settings,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.transaction.count({ where: { status: 'pending', type: 'deposit' } }),
      prisma.transaction.aggregate({
        where: { status: 'completed', type: 'deposit' },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { status: 'completed', type: 'withdrawal' },
        _sum: { amount: true },
      }),
      prisma.user.aggregate({
        _sum: { walletBalance: true },
      }),
      getSystemSettings(),
    ]);

    const totalDepositsCompleted = Number(totalRevenue._sum.amount || 0);
    const totalWithdrawalsCompleted = Number(totalWithdrawals._sum.amount || 0);
    const totalUserBalance = Number(userBalanceAggregate._sum.walletBalance || 0);
    const setupBalance = Number(settings.systemSetupBalance || 0);
    const systemUsableBalance = setupBalance - totalDepositsCompleted - totalWithdrawalsCompleted;

    // Get recent transactions
    const recentTransactions = await prisma.transaction.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { name: true, email: true, avatar: true },
        },
      },
    });

    // Get revenue data for last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyRevenue = await prisma.$queryRaw<Array<{ month: string; revenue: number; users: number }>>`
      SELECT 
        TO_CHAR(DATE_TRUNC('month', t."createdAt"), 'Mon') as month,
        COALESCE(SUM(t.amount), 0)::int as revenue,
        COUNT(DISTINCT u.id)::int as users
      FROM "Transaction" t
      LEFT JOIN "User" u ON DATE_TRUNC('month', u."createdAt") = DATE_TRUNC('month', t."createdAt")
      WHERE t."createdAt" >= ${sixMonthsAgo}
        AND t.status = 'completed'
        AND t.type = 'deposit'
      GROUP BY DATE_TRUNC('month', t."createdAt")
      ORDER BY DATE_TRUNC('month', t."createdAt") ASC
    `;

    // Get game distribution (placeholder - update when you have a games table)
    const gameDistribution = [
      { name: 'BGMI', value: 400, color: '#3b82f6' },
      { name: 'Free Fire', value: 300, color: '#8b5cf6' },
      { name: 'COD Mobile', value: 200, color: '#10b981' },
      { name: 'Valorant', value: 100, color: '#f59e0b' },
    ];

    // Get weekly tournament data for last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const weeklyTournaments = await prisma.$queryRaw<Array<{ day: string; tournaments: number; participants: number }>>`
      SELECT 
        TO_CHAR(DATE_TRUNC('day', "createdAt"), 'Dy') as day,
        COUNT(*)::int as tournaments,
        COALESCE(SUM("maxPlayers"), 0)::int as participants
      FROM "Tournament"
      WHERE "createdAt" >= ${sevenDaysAgo}
      GROUP BY DATE_TRUNC('day', "createdAt")
      ORDER BY DATE_TRUNC('day', "createdAt") ASC
    `;

    return NextResponse.json({
      stats: {
        totalUsers,
        activeGames: 4,
        pendingTransactions,
        totalRevenue: totalDepositsCompleted,
        totalDepositsCompleted,
        totalWithdrawalsCompleted,
        totalUserBalance,
        setupBalance,
        systemUsableBalance,
      },
      recentTransactions: recentTransactions.map((t) => ({
        id: t.id,
        user: t.user.name || t.user.email,
        userEmail: t.user.email,
        userAvatar: t.user.avatar,
        amount: t.amount,
        type: t.type,
        status: t.status,
        method: t.method,
        reference: t.reference,
        createdAt: t.createdAt,
      })),
      charts: {
        revenueData: monthlyRevenue.length > 0 ? monthlyRevenue : [
          { month: 'Jan', revenue: 0, users: 0 },
          { month: 'Feb', revenue: 0, users: 0 },
          { month: 'Mar', revenue: 0, users: 0 },
          { month: 'Apr', revenue: 0, users: 0 },
          { month: 'May', revenue: 0, users: 0 },
          { month: 'Jun', revenue: 0, users: 0 },
        ],
        gameDistribution,
        tournamentData: weeklyTournaments.length > 0 ? weeklyTournaments : [
          { day: 'Mon', tournaments: 0, participants: 0 },
          { day: 'Tue', tournaments: 0, participants: 0 },
          { day: 'Wed', tournaments: 0, participants: 0 },
          { day: 'Thu', tournaments: 0, participants: 0 },
          { day: 'Fri', tournaments: 0, participants: 0 },
          { day: 'Sat', tournaments: 0, participants: 0 },
          { day: 'Sun', tournaments: 0, participants: 0 },
        ],
      },
    });
  } catch (error) {
    console.error('Get stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
