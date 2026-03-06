import { NextRequest, NextResponse } from 'next/server';
import { requireAuthUser } from '@/lib/route-auth';
import { getSystemSettings } from '@/lib/system-settings';
import { prisma } from '@/lib/prisma';
import {
  buildFonepayPrn,
  buildFonepayPaymentUrl,
  buildFonepayReference,
  buildFonepayReturnUrl,
  getFonepayMode,
  getFonepayPid,
} from '@/lib/fonepay';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = (await req.json().catch(() => ({}))) as { amount?: number };
    const amount = Number(body.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Valid amount is required' }, { status: 400 });
    }

    const settings = await getSystemSettings();
    if (amount < settings.minDepositAmount) {
      return NextResponse.json(
        { error: `Minimum deposit is Rs ${settings.minDepositAmount.toFixed(0)}` },
        { status: 400 }
      );
    }

    const prn = buildFonepayPrn(auth.user.id);
    const reference = buildFonepayReference(prn);
    const tx = await prisma.transaction.create({
      data: {
        userId: auth.user.id,
        type: 'deposit',
        amount,
        method: 'fonepay',
        status: 'pending',
        reference,
      },
      select: { id: true, amount: true, status: true },
    });

    const ru = buildFonepayReturnUrl(req);
    const mode = getFonepayMode();
    const pid = getFonepayPid();
    const r1 = `wallet_topup_${tx.id}`;
    const r2 = `user_${auth.user.id}`;
    const payment = buildFonepayPaymentUrl({
      pid,
      ru,
      prn,
      amt: tx.amount,
      r1,
      r2,
    });

    return NextResponse.json({
      session: {
        transactionId: tx.id,
        prn,
        amt: tx.amount,
        ru,
        r1,
        r2,
        mode,
        pid,
        paymentUrl: payment.paymentUrl,
        dt: payment.dt,
        dv: payment.dv,
      },
    });
  } catch (error) {
    console.error('Create Fonepay session error:', error);
    return NextResponse.json({ error: 'Failed to create Fonepay session' }, { status: 500 });
  }
}
