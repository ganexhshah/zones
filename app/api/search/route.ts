import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

export const dynamic = 'force-dynamic';

type SearchItem = {
  title: string;
  subtitle: string;
  type: string;
  id?: string;
};

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(req.url);
    const q = String(searchParams.get('q') || '').trim();
    const query = q.toLowerCase();

    const quickSearches: SearchItem[] = [
      { title: 'Wallet', subtitle: 'Add money, withdraw and transactions', type: 'wallet' },
      { title: 'Tournaments', subtitle: 'Upcoming and active tournaments', type: 'tournament' },
      { title: 'Profile Settings', subtitle: 'Update profile and game IDs', type: 'profile' },
    ];

    const [recentTx, recentRegistrations] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId: auth.user.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.tournamentRegistration.findMany({
        where: { userId: auth.user.id },
        include: {
          tournament: { select: { id: true, title: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
    ]);

    const recentSearches: SearchItem[] = [
      ...recentRegistrations
        .filter((r) => !!r.tournament)
        .map((r) => ({
          title: r.tournament!.title,
          subtitle: 'Tournament',
          type: 'tournament',
          id: r.tournament!.id,
        })),
      ...recentTx.map((tx) => ({
        title: `${tx.type.toUpperCase()} • Rs ${Math.abs(Number(tx.amount || 0)).toFixed(0)}`,
        subtitle: `Wallet • ${tx.status}`,
        type: 'wallet',
        id: tx.id,
      })),
    ].slice(0, 8);

    if (!query) {
      return NextResponse.json({
        query: q,
        quickSearches,
        recentSearches,
        results: [],
      });
    }

    const tournaments = await prisma.tournament.findMany({
      where: {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { game: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        title: true,
        game: true,
        status: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });

    const keywordResults: SearchItem[] = [];
    if ('wallet'.includes(query) || 'withdraw'.includes(query) || 'deposit'.includes(query)) {
      keywordResults.push({
        title: 'Open Wallet',
        subtitle: 'Add money, withdraw and transactions',
        type: 'wallet',
      });
    }
    if ('profile'.includes(query) || 'uid'.includes(query) || 'game id'.includes(query)) {
      keywordResults.push({
        title: 'Profile Settings',
        subtitle: 'Update UID and account details',
        type: 'profile',
      });
    }

    const results: SearchItem[] = [
      ...keywordResults,
      ...tournaments.map((t) => ({
        title: t.title,
        subtitle: `Tournament • ${t.game} • ${t.status}`,
        type: 'tournament',
        id: t.id,
      })),
    ].slice(0, 20);

    return NextResponse.json({
      query: q,
      quickSearches,
      recentSearches,
      results,
    });
  } catch (error) {
    console.error('Search API error:', error);
    return NextResponse.json({ error: 'Failed to fetch search results' }, { status: 500 });
  }
}
