import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthPayload } from '@/lib/route-auth';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuthPayload(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const method = body.method ? String(body.method) : undefined;
    const reference = body.reference ? String(body.reference) : undefined;

    const payout = await prisma.tournamentPayout.findUnique({ where: { id: params.id } });
    if (!payout) return NextResponse.json({ error: 'Payout not found' }, { status: 404 });
    if (payout.status !== 'PENDING') {
      return NextResponse.json({ error: 'Payout is not pending' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedPayout = await tx.tournamentPayout.update({
        where: { id: payout.id },
        data: {
          status: 'SENT',
          processedAt: new Date(),
          method: method || payout.method || 'wallet',
          reference: reference || payout.reference,
        },
      });

      if ((method || payout.method || 'wallet') === 'wallet') {
        await tx.user.update({
          where: { id: payout.userId },
          data: { walletBalance: { increment: payout.amount } },
        });
        await tx.transaction.create({
          data: {
            userId: payout.userId,
            type: 'WINNING',
            amount: payout.amount,
            status: 'completed',
            method: 'wallet',
            reference: `payout:${payout.id}`,
          },
        });
      }

      return updatedPayout;
    });

    return NextResponse.json({ payout: result, executedBy: auth.payload.userId });
  } catch (error) {
    console.error('Execute payout error:', error);
    return NextResponse.json({ error: 'Failed to execute payout' }, { status: 500 });
  }
}
