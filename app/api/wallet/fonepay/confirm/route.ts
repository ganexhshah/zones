import { NextRequest, NextResponse } from 'next/server';
import { requireAuthUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';
import {
  normalizeFonepayPayload,
  parsePrnFromReference,
  settleFonepayTransaction,
} from '@/lib/fonepay';

type ConfirmBody = {
  transactionId?: string;
  paymentResult?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = (await req.json().catch(() => ({}))) as ConfirmBody;
    const transactionId = (body.transactionId || '').trim();
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
      select: { id: true, userId: true, amount: true, status: true, reference: true },
    });
    if (!tx) {
      return NextResponse.json({ error: 'Fonepay transaction not found' }, { status: 404 });
    }

    const payload = normalizeFonepayPayload(body.paymentResult);
    const expectedPrn = parsePrnFromReference(tx.reference);
    const providedPrn = (payload.PRN || '').trim();
    if (expectedPrn && providedPrn && expectedPrn !== providedPrn) {
      return NextResponse.json({ error: 'PRN mismatch' }, { status: 400 });
    }

    const settled = await settleFonepayTransaction({
      transaction: tx,
      payload,
      source: 'app_confirm',
    });

    return NextResponse.json({
      transactionId: tx.id,
      status: settled.status,
      credited: settled.credited,
      message: settled.message,
    });
  } catch (error) {
    console.error('Confirm Fonepay payment error:', error);
    return NextResponse.json({ error: 'Failed to confirm Fonepay payment' }, { status: 500 });
  }
}
