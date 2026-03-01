import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuthUser(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const filter = (searchParams.get('filter') || 'All').trim().toLowerCase();

    // Get current user ID to exclude from results
    const currentUserId = authResult.user.id;

    // Build base where clause
    let whereClause: any = {
      id: { not: currentUserId },
      isBlocked: false,
    };

    // Add search filter
    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Apply filter-specific constraints/sort
    let orderBy: any = { createdAt: 'desc' };
    if (filter === 'top players') {
      orderBy = { walletBalance: 'desc' };
    } else if (filter === 'friends') {
      const myRows = await prisma.customMatchParticipant.findMany({
        where: { userId: currentUserId },
        select: { customMatchId: true },
        take: 200,
      });
      const myMatchIds = myRows.map((r) => r.customMatchId);
      if (myMatchIds.length > 0) {
        whereClause.customMatchParticipants = {
          some: {
            customMatchId: { in: myMatchIds },
          },
        };
      }
    }

    // Fetch users
    const users = await prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        walletBalance: true,
        createdAt: true,
        _count: {
          select: {
            customMatchesCreated: true,
            customMatchParticipants: true,
          },
        },
      },
      orderBy,
      take: 50,
    });

    // Format response
    const formattedUsers = users.map((user) => {
      const totalMatches =
        user._count.customMatchesCreated + user._count.customMatchParticipants;
      
      let level = 'Beginner';
      if (totalMatches >= 50) level = 'Master';
      else if (totalMatches >= 20) level = 'Elite';
      else if (totalMatches >= 5) level = 'Pro';

      return {
        id: user.id,
        name: user.name || user.email,
        username: `@${(user.name || user.email).toLowerCase().replace(/\s+/g, '_')}`,
        avatar: user.avatar,
        level,
        balance: user.walletBalance || 0,
        isOnline: Math.random() > 0.5, // TODO: Implement real online status
      };
    });

    return NextResponse.json({ users: formattedUsers });
  } catch (error) {
    console.error('Error fetching users for gift:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}
