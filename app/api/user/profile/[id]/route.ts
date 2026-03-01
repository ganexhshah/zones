import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAuthUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const userId = params.id?.trim();
    if (!userId) {
      return NextResponse.json({ error: 'User id is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        createdAt: true,
        gameIds: {
          select: {
            id: true,
            gameName: true,
            gameId: true,
            inGameName: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: {
            customMatchesCreated: true,
            customMatchParticipants: true,
            transactions: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const recentActivities = await prisma.transaction.findMany({
      where: { userId },
      select: {
        id: true,
        type: true,
        amount: true,
        status: true,
        reference: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });

    return NextResponse.json({
      user: {
        ...user,
        stats: {
          customMatchesCreated: user._count.customMatchesCreated,
          customMatchesPlayed: user._count.customMatchParticipants,
          totalActivities: user._count.transactions,
        },
      },
      recentActivities,
    });
  } catch (error) {
    console.error('User profile by id error:', error);
    return NextResponse.json({ error: 'Failed to fetch user profile' }, { status: 500 });
  }
}

