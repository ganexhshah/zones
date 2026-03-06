import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';
import { dailyRewardCoins } from '@/lib/rewards';

export const dynamic = 'force-dynamic';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get('page') || DEFAULT_PAGE));
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(searchParams.get('limit') || DEFAULT_LIMIT)));
    const action = (searchParams.get('action') || 'all').trim().toLowerCase();
    const search = (searchParams.get('search') || '').trim();
    const skip = (page - 1) * limit;

    const where: any = {};
    if (action !== 'all') {
      where.action = action;
    }
    if (search) {
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { action: { contains: search, mode: 'insensitive' } },
        {
          user: {
            is: {
              email: { contains: search, mode: 'insensitive' },
            },
          },
        },
        {
          user: {
            is: {
              name: { contains: search, mode: 'insensitive' },
            },
          },
        },
      ];
    }

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const dailyCoinValue = dailyRewardCoins(1);

    const [
      audits,
      totalAudits,
      actionCounts,
      rewardUsers,
      pendingSpinAggregate,
      totalSpins,
      spinsLast7Days,
      spinCoinsAggregate,
      spinCoins7DaysAggregate,
      coinWithdrawalAggregate,
      coinWithdrawal7DaysAggregate,
      recentWithdrawals,
    ] = await Promise.all([
      prisma.rewardAudit.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
        },
      }),
      prisma.rewardAudit.count({ where }),
      prisma.rewardAudit.groupBy({
        by: ['action'],
        _count: { _all: true },
      }),
      prisma.userRewardState.count(),
      prisma.userRewardState.aggregate({
        _sum: { spinTokens: true },
        _count: { _all: true },
      }),
      prisma.rewardSpin.count(),
      prisma.rewardSpin.count({
        where: { createdAt: { gte: weekAgo } },
      }),
      prisma.rewardSpin.aggregate({
        where: { rewardType: 'coins' },
        _sum: { rewardValue: true },
      }),
      prisma.rewardSpin.aggregate({
        where: {
          rewardType: 'coins',
          createdAt: { gte: weekAgo },
        },
        _sum: { rewardValue: true },
      }),
      prisma.transaction.aggregate({
        where: { type: 'reward_coin_withdrawal' },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.transaction.aggregate({
        where: {
          type: 'reward_coin_withdrawal',
          createdAt: { gte: weekAgo },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.transaction.findMany({
        where: { type: 'reward_coin_withdrawal' },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
        },
      }),
    ]);

    const actionCountMap = actionCounts.reduce<Record<string, number>>((acc, row) => {
      acc[row.action] = row._count._all;
      return acc;
    }, {});

    const totalDailyClaims = actionCountMap.daily_claim || 0;
    const dailyClaims7Days = await prisma.rewardAudit.count({
      where: { action: 'daily_claim', createdAt: { gte: weekAgo } },
    });

    const totalCoinsFromDaily = totalDailyClaims * dailyCoinValue;
    const totalCoinsFromSpins = Number(spinCoinsAggregate._sum.rewardValue || 0);
    const totalCoinsDistributed = totalCoinsFromDaily + totalCoinsFromSpins;

    const recentActivities = audits.map((audit) => ({
      id: audit.id,
      action: audit.action,
      metadata: audit.metadata,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
      createdAt: audit.createdAt,
      user: audit.user,
    }));

    return NextResponse.json({
      stats: {
        rewardUsers,
        usersWithSpinTokens: pendingSpinAggregate._count._all,
        pendingSpinTokens: Number(pendingSpinAggregate._sum.spinTokens || 0),
        totalDailyClaims,
        dailyClaims7Days,
        totalSpins,
        spinsLast7Days,
        totalCoinsFromDaily,
        totalCoinsFromSpins,
        coinsFromSpins7Days: Number(spinCoins7DaysAggregate._sum.rewardValue || 0),
        totalCoinsDistributed,
        totalCoinWithdrawals: Number(coinWithdrawalAggregate._count._all || 0),
        totalRupeesCredited: Number(coinWithdrawalAggregate._sum.amount || 0),
        withdrawals7Days: Number(coinWithdrawal7DaysAggregate._count._all || 0),
        rupeesCredited7Days: Number(coinWithdrawal7DaysAggregate._sum.amount || 0),
        actionCounts: actionCountMap,
      },
      recentActivities,
      recentWithdrawals: recentWithdrawals.map((row) => ({
        id: row.id,
        amount: row.amount,
        status: row.status,
        reference: row.reference,
        createdAt: row.createdAt,
        user: row.user,
      })),
      pagination: {
        page,
        limit,
        total: totalAudits,
        totalPages: Math.ceil(totalAudits / limit),
      },
    });
  } catch (error) {
    console.error('Get admin rewards error:', error);
    return NextResponse.json({ error: 'Failed to fetch reward management data' }, { status: 500 });
  }
}

