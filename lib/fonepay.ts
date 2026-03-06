import { createHmac, randomBytes } from 'crypto';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendPushToUser } from '@/lib/push';

export type FonepayPayload = Record<string, string>;

type FonepayTransaction = {
  id: string;
  userId: string;
  amount: number;
  status: string;
  reference: string | null;
};

type SettlementSource = 'app_confirm' | 'callback';

const FONEPAY_REF_PREFIX = 'fonepay_prn:';
const DEMO_PID = process.env.FONEPAY_DEMO_PID || 'fonepay123';
const DEMO_SECRET = process.env.FONEPAY_DEMO_SECRET || 'fonepay';
const MODE = (process.env.FONEPAY_MODE || 'demo').toLowerCase();
const DEV_URL = 'https://dev-clientapi.fonepay.com/api/merchantRequest?';

export function getFonepayMode() {
  return MODE === 'live' ? 'live' : 'demo';
}

export function getFonepayPid() {
  return DEMO_PID;
}

function formatFonepayDate(date: Date) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `${mm}/${dd}/${yyyy}`;
}

export function buildFonepayPaymentUrl(params: {
  pid: string;
  ru: string;
  prn: string;
  amt: number;
  r1: string;
  r2: string;
  md?: string;
  crn?: string;
}) {
  const md = params.md || 'P';
  const crn = params.crn || 'NPR';
  const dt = formatFonepayDate(new Date());
  const amt = Number(params.amt);
  const amountText = Number.isInteger(amt) ? amt.toFixed(1) : amt.toString();
  const dvPayload = `${params.pid},${md},${params.prn},${amountText},${crn},${dt},${params.r1},${params.r2},${params.ru}`;
  const dv = createHmac('sha512', DEMO_SECRET).update(dvPayload, 'utf8').digest('hex');

  const query = new URLSearchParams({
    PID: params.pid,
    MD: md,
    AMT: amountText,
    CRN: crn,
    DT: dt,
    R1: params.r1,
    R2: params.r2,
    DV: dv,
    RU: params.ru,
    PRN: params.prn,
  });

  return {
    paymentUrl: `${DEV_URL}${query.toString()}`,
    dt,
    md,
    crn,
    dv,
    amountText,
  };
}

export function buildFonepayPrn(userId: string) {
  const shortUser = userId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'user';
  const rand = randomBytes(3).toString('hex');
  return `CZ-${Date.now()}-${shortUser}-${rand}`.slice(0, 30);
}

export function buildFonepayReference(prn: string) {
  return `${FONEPAY_REF_PREFIX}${prn}`;
}

export function parsePrnFromReference(reference: string | null) {
  if (!reference) return null;
  if (!reference.startsWith(FONEPAY_REF_PREFIX)) return null;
  const raw = reference.split('|')[0];
  return raw.slice(FONEPAY_REF_PREFIX.length).trim() || null;
}

export function buildFonepayReturnUrl(req: NextRequest) {
  const requestUrl = new URL(req.url);
  const host =
    req.headers.get('x-forwarded-host') ??
    req.headers.get('host') ??
    requestUrl.host;
  const protocol =
    req.headers.get('x-forwarded-proto') ??
    requestUrl.protocol.replace(':', '');
  return `${protocol}://${host}/api/wallet/fonepay/callback`;
}

export function normalizeFonepayPayload(input: unknown): FonepayPayload {
  if (!input || typeof input !== 'object') return {};
  const source = input as Record<string, unknown>;
  const normalized: FonepayPayload = {};
  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue;
    normalized[key.toUpperCase()] = String(value);
  }
  return normalized;
}

function resolvePaymentOutcome(payload: FonepayPayload) {
  const rc = (payload.RC || '').toLowerCase().trim();
  const ps = (payload.PS || '').toLowerCase().trim();
  if (rc === 'successful' || ps === 'success' || ps === 'successful') {
    return 'completed' as const;
  }
  if (rc === 'failed' || rc === 'cancelled' || ps === 'failed' || ps === 'cancelled') {
    return 'rejected' as const;
  }
  return 'pending' as const;
}

function mergeReference(base: string | null, payload: FonepayPayload, source: SettlementSource) {
  const preserved = (base || '').split('|')[0];
  const rc = payload.RC || 'na';
  const ps = payload.PS || 'na';
  const uid = payload.UID || '';
  const suffix = `source=${source};rc=${rc};ps=${ps}${uid ? `;uid=${uid}` : ''}`;
  if (!preserved) return suffix;
  return `${preserved}|${suffix}`;
}

export async function settleFonepayTransaction(params: {
  transaction: FonepayTransaction;
  payload: FonepayPayload;
  source: SettlementSource;
}) {
  const { transaction, payload, source } = params;
  const outcome = resolvePaymentOutcome(payload);
  const mergedReference = mergeReference(transaction.reference, payload, source);

  if (outcome === 'completed') {
    const credited = await prisma.$transaction(async (tx) => {
      const marked = await tx.transaction.updateMany({
        where: { id: transaction.id, status: { not: 'completed' } },
        data: { status: 'completed', reference: mergedReference },
      });
      if (marked.count === 0) return false;
      await tx.user.update({
        where: { id: transaction.userId },
        data: {
          walletBalance: {
            increment: transaction.amount,
          },
        },
      });
      return true;
    });

    if (credited) {
      await sendPushToUser(transaction.userId, {
        title: 'Fonepay Deposit Successful',
        body: `Rs ${transaction.amount.toFixed(2)} added to your wallet.`,
        data: {
          type: 'deposit',
          method: 'fonepay',
          status: 'completed',
          transactionId: transaction.id,
        },
      });
    }

    return {
      status: 'completed' as const,
      credited,
      message: credited
        ? 'Payment successful. Wallet credited.'
        : 'Payment already completed earlier.',
    };
  }

  if (outcome === 'rejected') {
    const rejected = await prisma.transaction.updateMany({
      where: { id: transaction.id, status: 'pending' },
      data: { status: 'rejected', reference: mergedReference },
    });
    if (rejected.count > 0) {
      await sendPushToUser(transaction.userId, {
        title: 'Fonepay Payment Failed',
        body: 'Payment was not completed. Wallet was not credited.',
        data: {
          type: 'deposit',
          method: 'fonepay',
          status: 'rejected',
          transactionId: transaction.id,
        },
      });
    }
    return {
      status: 'rejected' as const,
      credited: false,
      message: 'Payment failed or cancelled.',
    };
  }

  await prisma.transaction.update({
    where: { id: transaction.id },
    data: { reference: mergedReference },
  });
  return {
    status: 'pending' as const,
    credited: false,
    message: 'Payment status is still pending.',
  };
}
