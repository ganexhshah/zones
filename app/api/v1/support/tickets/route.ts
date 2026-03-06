import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';
import { getAdminEmailRecipients, sendEmail, sendEmailMany } from '@/lib/email';

const allowedServices = new Set([
  'WALLET_ISSUE',
  'TOURNAMENT_ISSUE',
  'APP_ISSUE',
  'CUSTOM_MATCH_ISSUE',
  'PAYMENT_ISSUE',
  'OTHER',
]);

function parseMeta(meta: Prisma.JsonValue | null) {
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

function str(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function parseCsvEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const rows = await prisma.userNotification.findMany({
      where: {
        userId: auth.user.id,
        category: 'SUPPORT_TICKET',
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const tickets = rows.map((row) => {
      const meta = parseMeta(row.metadata as Prisma.JsonValue | null);
      const status = str(meta['status']);
      return {
        id: row.id,
        issueId: row.id,
        service: str(meta['service']),
        description: str(meta['description']),
        imageUrl: str(meta['imageUrl']),
        status: status.length == 0 ? 'SUBMITTED' : status,
        adminNote: str(meta['adminNote']),
        reviewedAt: str(meta['reviewedAt']),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    return ok({ tickets });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const body = (await req.json().catch(() => ({}))) as {
      service?: string;
      description?: string;
      imageUrl?: string;
      agreeTerms?: boolean;
    };

    const service = (body.service ?? '').trim().toUpperCase();
    const description = (body.description ?? '').trim();
    const imageUrl = (body.imageUrl ?? '').trim();
    const agreeTerms = body.agreeTerms == true;

    if (!allowedServices.has(service)) {
      return fail('Please select a valid support service', 400);
    }
    if (description.length < 10) {
      return fail('Description must be at least 10 characters', 400);
    }
    if (!agreeTerms) {
      return fail('You must agree to the terms and conditions', 400);
    }

    const note = await prisma.userNotification.create({
      data: {
        userId: auth.user.id,
        category: 'SUPPORT_TICKET',
        title: 'Support ticket submitted',
        message: 'Your support ticket has been submitted and is under review.',
        metadata: {
          service,
          description,
          imageUrl: imageUrl.length == 0 ? null : imageUrl,
          status: 'SUBMITTED',
          adminNote: null,
          reviewedByUserId: null,
          reviewedAt: null,
          agreedToTerms: true,
        },
        imageUrl: imageUrl.length == 0 ? null : imageUrl,
      },
    });

    if (auth.user.email) {
      await sendEmail(
        auth.user.email,
        'Support Ticket Received - Crackzone',
        `
        <div style="font-family: Arial, sans-serif; padding: 16px;">
          <h2>Support ticket submitted</h2>
          <p>Hello ${auth.user.name ?? 'Player'},</p>
          <p>We received your support ticket <strong>${note.id}</strong>.</p>
          <p><strong>Service:</strong> ${service.split('_').join(' ')}</p>
          <p><strong>Description:</strong> ${description}</p>
          <p>Our support team will review and update the status soon.</p>
        </div>
        `,
      );
    }

    const adminEmails = getAdminEmailRecipients();
    if (adminEmails.length > 0) {
      await sendEmailMany(
        adminEmails,
        'New Support Ticket Submitted',
        `
        <div style="font-family: Arial, sans-serif; padding: 16px;">
          <h2>New support ticket</h2>
          <p><strong>User:</strong> ${auth.user.name ?? auth.user.email ?? auth.user.id}</p>
          <p><strong>Issue ID:</strong> ${note.id}</p>
          <p><strong>Service:</strong> ${service.split('_').join(' ')}</p>
          <p><strong>Description:</strong> ${description}</p>
          <p><strong>Attachment:</strong> ${imageUrl.length == 0 ? 'N/A' : `<a href="${imageUrl}">View image</a>`}</p>
        </div>
        `,
      );
    }

    const adminUsersByEmail = adminEmails.length == 0
      ? []
      : await prisma.user.findMany({
          where: { email: { in: adminEmails } },
          select: { id: true },
        });
    const envAdminEmails = parseCsvEnv(process.env.ADMIN_EMAILS).concat(
      parseCsvEnv(process.env.ADMIN_EMAIL),
    );
    const mainAdminUsers = envAdminEmails.length == 0
      ? []
      : await prisma.user.findMany({
          where: { email: { in: envAdminEmails } },
          select: { id: true },
        });
    const subAdminUsers = await prisma.subAdmin.findMany({
      where: { isActive: true },
      select: { userId: true },
    });

    const adminUserIds = Array.from(
      new Set<string>([
        ...adminUsersByEmail.map((u) => u.id),
        ...mainAdminUsers.map((u) => u.id),
        ...subAdminUsers.map((u) => u.userId),
      ]),
    );
    if (adminUserIds.length > 0) {
      await prisma.userNotification.createMany({
        data: adminUserIds.map((userId) => ({
          userId,
          category: 'SUPPORT_ADMIN',
          title: 'New support ticket submitted',
          message: `Ticket ${note.id} requires review.`,
          metadata: {
            ticketId: note.id,
            service,
            reportedByUserId: auth.user.id,
            reportedByName: auth.user.name ?? auth.user.email ?? auth.user.id,
            status: 'SUBMITTED',
          },
        })),
      });
    }

    return ok(
      {
        ticket: {
          id: note.id,
          issueId: note.id,
          service,
          description,
          imageUrl,
          status: 'SUBMITTED',
          createdAt: note.createdAt,
        },
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
