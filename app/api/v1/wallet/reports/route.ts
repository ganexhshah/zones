import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';
import { getAdminEmailRecipients, sendEmail, sendEmailMany } from '@/lib/email';

function parseMeta(meta: Prisma.JsonValue | null) {
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

function str(value: unknown) {
  return typeof value === 'string' ? value : '';
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const rows = await prisma.userNotification.findMany({
      where: {
        userId: auth.user.id,
        category: 'WALLET_REPORT',
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const reports = rows.map((r) => {
      const meta = parseMeta(r.metadata as Prisma.JsonValue | null);
      const status = str(meta['status']);
      return {
        id: r.id,
        transactionId: str(meta['transactionId']),
        transactionType: str(meta['transactionType']),
        transactionAmount: str(meta['transactionAmount']),
        reason: str(meta['reason']),
        details: str(meta['details']),
        status: status.length == 0 ? 'SUBMITTED' : status,
        adminNote: str(meta['adminNote']),
        createdAt: r.createdAt,
      };
    });

    return ok({ reports });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const body = (await req.json().catch(() => ({}))) as {
      transactionId?: string;
      reason?: string;
      details?: string;
    };

    const transactionId = (body.transactionId ?? '').trim();
    const reason = (body.reason ?? '').trim();
    const details = (body.details ?? '').trim();

    if (transactionId.length == 0) return fail('transactionId is required', 400);
    if (reason.length < 3) return fail('Reason is too short', 400);

    const tx = await prisma.transaction.findFirst({
      where: { id: transactionId, userId: auth.user.id },
      select: { id: true, type: true, amount: true, status: true, createdAt: true },
    });
    if (!tx) return fail('Transaction not found', 404);

    const note = await prisma.userNotification.create({
      data: {
        userId: auth.user.id,
        category: 'WALLET_REPORT',
        title: 'Wallet Report Submitted',
        message: 'Your wallet transaction report was submitted and is under review.',
        metadata: {
          transactionId: tx.id,
          transactionType: tx.type,
          transactionAmount: tx.amount,
          transactionStatus: tx.status,
          reason,
          details: details.length == 0 ? null : details,
          status: 'SUBMITTED',
          adminNote: null,
        },
      },
    });

    if (auth.user.email) {
      await sendEmail(
        auth.user.email,
        'Wallet Report Received - Crackzone',
        `
        <div style="font-family: Arial, sans-serif; padding: 16px;">
          <h2>Wallet report submitted</h2>
          <p>Hello ${auth.user.name ?? 'Player'},</p>
          <p>We received your wallet report for transaction <strong>${tx.id}</strong>.</p>
          <p><strong>Reason:</strong> ${reason}</p>
          <p>Our support team will review and update the report status.</p>
        </div>
        `,
      );
    }

    const adminEmails = getAdminEmailRecipients();
    if (adminEmails.length > 0) {
      await sendEmailMany(
        adminEmails,
        'New Wallet Report Submitted',
        `
        <div style="font-family: Arial, sans-serif; padding: 16px;">
          <h2>New wallet report</h2>
          <p><strong>User:</strong> ${auth.user.name ?? auth.user.email ?? auth.user.id}</p>
          <p><strong>Transaction ID:</strong> ${tx.id}</p>
          <p><strong>Reason:</strong> ${reason}</p>
          <p><strong>Details:</strong> ${details.length == 0 ? 'N/A' : details}</p>
        </div>
        `,
      );
    }

    return ok({ reportId: note.id, status: 'SUBMITTED' }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
