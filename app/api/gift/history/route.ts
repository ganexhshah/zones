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

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: authResult.user.id,
        type: { in: ['gift_sent', 'gift_received'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        type: true,
        amount: true,
        status: true,
        reference: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ history: transactions });
  } catch (error) {
    console.error('Error fetching gift history:', error);
    return NextResponse.json({ error: 'Failed to fetch gift history' }, { status: 500 });
  }
}

