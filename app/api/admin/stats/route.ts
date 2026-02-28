import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

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

    // Get stats
    const [
      totalUsers,
      pendingTransactions,
      totalRevenue,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.transaction.count({ where: { status: 'pending', type: 'deposit' } }),
      prisma.transaction.aggregate({
        where: { status: 'completed', type: 'deposit' },
        _sum: { amount: true },
      }),
    ]);

    // Get recent transactions
    const recentTransactions = await prisma.transaction.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { name: true, email: true },
        },
      },
    });

    return NextResponse.json({
      stats: {
        totalUsers,
        activeGames: 4, // Placeholder - can be updated to count from a Games table later
        pendingTransactions,
        totalRevenue: totalRevenue._sum.amount || 0,
      },
      recentTransactions: recentTransactions.map((t) => ({
        id: t.id,
        user: t.user.name || t.user.email,
        amount: t.amount,
        type: t.type,
        status: t.status,
        createdAt: t.createdAt,
      })),
    });
  } catch (error) {
    console.error('Get stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
