import { NextRequest, NextResponse } from 'next/server';
import { requireAuthUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const url = new URL(req.url);
    const transactionId = (url.searchParams.get('transactionId') || '').trim();
    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }

    const tx = await prisma.transaction.findFirst({
      where: {
        id: transactionId,
        userId: auth.user.id,
        method: 'fonepay',
        type: 'deposit',
      },
      select: {
        id: true,
        amount: true,
        status: true,
        method: true,
        reference: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!tx) {
      return NextResponse.json({ error: 'Fonepay transaction not found' }, { status: 404 });
    }

    return NextResponse.json({
      transaction: tx,
      done: tx.status === 'completed' || tx.status === 'rejected',
      credited: tx.status === 'completed',
    });
  } catch (error) {
    console.error('Get Fonepay status error:', error);
    return NextResponse.json({ error: 'Failed to fetch Fonepay status' }, { status: 500 });
  }
}
