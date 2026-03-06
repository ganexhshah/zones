import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const userId = params.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        avatar: true,
        walletBalance: true,
        availableBalance: true,
        lockedBalance: true,
        coinBalance: true,
        freeEntryTokens: true,
        isVerified: true,
        isBlocked: true,
        blockReason: true,
        suspendedUntil: true,
        unblockRequestStatus: true,
        unblockRequestMessage: true,
        unblockRequestedAt: true,
        unblockReviewNote: true,
        unblockReviewedAt: true,
        authProvider: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            transactions: true,
            tournaments: true,
            gameIds: true,
          },
        },
        gameIds: {
          select: {
            gameName: true,
            gameId: true,
          },
        },
        pushTokens: {
          select: {
            id: true,
            deviceId: true,
            platform: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 50,
        },
        fraudFlags: {
          where: {
            ip: {
              not: null,
            },
          },
          select: {
            ip: true,
            reason: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const [
      allTransactions,
      totalDepositAgg,
      totalWithdrawalAgg,
      pendingWithdrawalAgg,
      tournamentWinCount,
      tournamentLossCount,
      customMatchWinCount,
      customMatchLossCount,
      winningTransactions,
      recentTournamentWins,
      recentCustomWins,
    ] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 300,
        select: {
          id: true,
          type: true,
          amount: true,
          status: true,
          method: true,
          reference: true,
          screenshot: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.transaction.aggregate({
        where: { userId, type: 'deposit', status: 'completed' },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.transaction.aggregate({
        where: { userId, type: 'withdrawal', status: 'completed' },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.transaction.aggregate({
        where: { userId, type: 'withdrawal', status: 'pending' },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.tournamentMatchParticipant.count({
        where: {
          isWinner: true,
          registration: { userId },
        },
      }),
      prisma.tournamentMatchParticipant.count({
        where: {
          isWinner: false,
          registration: { userId },
        },
      }),
      prisma.customMatchResultSubmission.count({
        where: {
          winnerUserId: userId,
          status: 'APPROVED',
        },
      }),
      prisma.customMatchResultSubmission.count({
        where: {
          status: 'APPROVED',
          winnerUserId: { not: userId },
          customMatch: {
            participants: {
              some: { userId },
            },
          },
        },
      }),
      prisma.transaction.findMany({
        where: {
          userId,
          type: { in: ['WINNING', 'winning', 'TOURNAMENT_WIN', 'tournament_win'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          type: true,
          amount: true,
          status: true,
          reference: true,
          createdAt: true,
        },
      }),
      prisma.tournamentMatchParticipant.findMany({
        where: {
          isWinner: true,
          registration: { userId },
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          createdAt: true,
          match: {
            select: {
              id: true,
              roundNo: true,
              tournament: {
                select: { id: true, title: true, game: true },
              },
            },
          },
        },
      }),
      prisma.customMatchResultSubmission.findMany({
        where: {
          winnerUserId: userId,
          status: 'APPROVED',
        },
        orderBy: { reviewedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          reviewedAt: true,
          createdAt: true,
          customMatch: {
            select: {
              id: true,
              title: true,
              mode: true,
              roomType: true,
              entryFee: true,
            },
          },
        },
      }),
    ]);

    const loginEventCount = user.pushTokens.length;
    const lastLogin = user.pushTokens[0] ?? null;
    const latestDeviceId = lastLogin?.deviceId ?? null;
    const latestKnownIp = user.fraudFlags[0]?.ip ?? null;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setHours(0, 0, 0, 0);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const loginTrendRaw = await prisma.$queryRaw<Array<{ date: string; logins: number }>>`
      SELECT 
        TO_CHAR(DATE_TRUNC('day', "updatedAt"), 'Mon DD') as date,
        COUNT(*)::int as logins
      FROM "UserPushToken"
      WHERE "userId" = ${userId} AND "updatedAt" >= ${sevenDaysAgo}
      GROUP BY DATE_TRUNC('day', "updatedAt")
      ORDER BY DATE_TRUNC('day', "updatedAt") ASC
    `;

    const loginTrendMap = new Map(loginTrendRaw.map((row) => [row.date, Number(row.logins || 0)]));
    const loginTrend7d = Array.from({ length: 7 }, (_, idx) => {
      const d = new Date(sevenDaysAgo);
      d.setDate(sevenDaysAgo.getDate() + idx);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
      return {
        date: label,
        logins: loginTrendMap.get(label) ?? 0,
      };
    });

    const txTypeCounts = allTransactions.reduce<Record<string, number>>((acc, tx) => {
      acc[tx.type] = (acc[tx.type] || 0) + 1;
      return acc;
    }, {});

    const platformActivity = Object.entries(txTypeCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    const totalDeposit = Number(totalDepositAgg._sum.amount || 0);
    const totalWithdrawal = Number(totalWithdrawalAgg._sum.amount || 0);
    const pendingWithdrawal = Number(pendingWithdrawalAgg._sum.amount || 0);

    const { pushTokens, ...safeUser } = user;

    return NextResponse.json({
      ...safeUser,
      walletBalance: Number(user.walletBalance || 0),
      availableBalance: Number(user.availableBalance || 0),
      lockedBalance: Number(user.lockedBalance || 0),
      latestDeviceId,
      latestKnownIp,
      lastLoginAt: lastLogin?.updatedAt ?? null,
      securityDevices: user.pushTokens.map((token) => ({
        deviceId: token.deviceId,
        platform: token.platform,
        isActive: token.isActive,
        createdAt: token.createdAt,
        updatedAt: token.updatedAt,
      })),
      securityIps: user.fraudFlags,
      loginAnalytics: {
        totalLoginEvents: loginEventCount,
        activeDeviceCount: user.pushTokens.filter((token) => token.isActive).length,
        uniqueDeviceCount: new Set(user.pushTokens.map((token) => token.deviceId).filter(Boolean)).size,
        loginTrend7d,
      },
      financeSummary: {
        totalDeposit,
        totalWithdrawal,
        pendingWithdrawal,
        netFlow: totalDeposit - totalWithdrawal,
        availableBalance: Number(user.availableBalance || 0),
        lockedBalance: Number(user.lockedBalance || 0),
        walletBalance: Number(user.walletBalance || 0),
      },
      performanceSummary: {
        tournamentWins: tournamentWinCount,
        tournamentLosses: tournamentLossCount,
        customMatchWins: customMatchWinCount,
        customMatchLosses: customMatchLossCount,
        totalWins: tournamentWinCount + customMatchWinCount,
        totalLosses: tournamentLossCount + customMatchLossCount,
      },
      winningSources: {
        winningTransactions,
        recentTournamentWins: recentTournamentWins.map((row) => ({
          id: row.id,
          wonAt: row.createdAt,
          tournamentId: row.match.tournament.id,
          tournamentTitle: row.match.tournament.title,
          game: row.match.tournament.game,
          roundNo: row.match.roundNo,
        })),
        recentCustomWins: recentCustomWins.map((row) => ({
          id: row.id,
          wonAt: row.reviewedAt || row.createdAt,
          customMatchId: row.customMatch.id,
          customMatchTitle: row.customMatch.title,
          mode: row.customMatch.mode,
          roomType: row.customMatch.roomType,
          entryFee: row.customMatch.entryFee,
        })),
      },
      platformAnalytics: {
        transactionTypeDistribution: platformActivity,
        totalTransactions: allTransactions.length,
      },
      recentTransactions: allTransactions.slice(0, 20),
      allTransactions,
    });
  } catch (error) {
    console.error('Get user details error:', error);
    return NextResponse.json({ error: 'Failed to fetch user details' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }

    const userId = params.id;
    const body = await req.json().catch(() => ({}));

    const rawCoinBalance = body?.coinBalance;
    const rawFreeEntryTokens = body?.freeEntryTokens;

    const coinBalance = Number(rawCoinBalance);
    const freeEntryTokens = Number(rawFreeEntryTokens);

    if (!Number.isInteger(coinBalance) || coinBalance < 0) {
      return NextResponse.json({ error: 'coinBalance must be a non-negative integer' }, { status: 400 });
    }

    if (!Number.isInteger(freeEntryTokens) || freeEntryTokens < 0) {
      return NextResponse.json({ error: 'freeEntryTokens must be a non-negative integer' }, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, coinBalance: true, freeEntryTokens: true },
    });

    if (!existingUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          coinBalance,
          freeEntryTokens,
        },
        select: {
          id: true,
          coinBalance: true,
          freeEntryTokens: true,
          updatedAt: true,
        },
      });

      await tx.rewardAudit.create({
        data: {
          userId,
          action: 'admin_reward_balance_update',
          metadata: {
            previousCoinBalance: existingUser.coinBalance,
            newCoinBalance: coinBalance,
            previousFreeEntryTokens: existingUser.freeEntryTokens,
            newFreeEntryTokens: freeEntryTokens,
            adminUserId: adminAuth.user.id,
          },
          ipAddress: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
          userAgent: req.headers.get('user-agent') || '',
        },
      });

      return user;
    });

    return NextResponse.json({
      success: true,
      user: updated,
      message: 'Reward balances updated successfully',
    });
  } catch (error) {
    console.error('Update user reward balances error:', error);
    return NextResponse.json({ error: 'Failed to update reward balances' }, { status: 500 });
  }
}
