import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  normalizeFonepayPayload,
  parsePrnFromReference,
  settleFonepayTransaction,
} from '@/lib/fonepay';

async function parseIncomingPayload(req: NextRequest) {
  const fromQuery = Object.fromEntries(new URL(req.url).searchParams.entries());
  if (Object.keys(fromQuery).length > 0) return normalizeFonepayPayload(fromQuery);

  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => ({}));
    return normalizeFonepayPayload(body);
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await req.text().catch(() => '');
    const params = new URLSearchParams(text);
    return normalizeFonepayPayload(Object.fromEntries(params.entries()));
  }
  return {};
}

async function handleCallback(req: NextRequest) {
  const payload = await parseIncomingPayload(req);
  const prn = (payload.PRN || '').trim();
  if (!prn) {
    return NextResponse.json({ error: 'PRN is required' }, { status: 400 });
  }

  const tx = await prisma.transaction.findFirst({
    where: {
      type: 'deposit',
      method: 'fonepay',
      reference: {
        startsWith: `fonepay_prn:${prn}`,
      },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, userId: true, amount: true, status: true, reference: true },
  });

  if (!tx) {
    return NextResponse.json({ error: 'Transaction not found for PRN' }, { status: 404 });
  }

  const expectedPrn = parsePrnFromReference(tx.reference);
  if (expectedPrn && expectedPrn !== prn) {
    return NextResponse.json({ error: 'PRN mismatch' }, { status: 400 });
  }

  const settled = await settleFonepayTransaction({
    transaction: tx,
    payload,
    source: 'callback',
  });

  return NextResponse.json({
    transactionId: tx.id,
    status: settled.status,
    credited: settled.credited,
    message: settled.message,
  });
}

export async function GET(req: NextRequest) {
  try {
    return await handleCallback(req);
  } catch (error) {
    console.error('Fonepay callback GET error:', error);
    return NextResponse.json({ error: 'Failed to process callback' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    return await handleCallback(req);
  } catch (error) {
    console.error('Fonepay callback POST error:', error);
    return NextResponse.json({ error: 'Failed to process callback' }, { status: 500 });
  }
}
