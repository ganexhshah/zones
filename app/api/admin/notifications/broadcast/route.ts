import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';
import { cloudinary } from '@/lib/cloudinary';
import { sendPushToAllUsers, sendPushToUser } from '@/lib/push';
import { createNotificationForAllUsers } from '@/lib/notifications';
import { sendEmailMany } from '@/lib/email';

export const dynamic = 'force-dynamic';

type EmailTemplateType = 'GENERAL' | 'PROMOTION' | 'MAINTENANCE' | 'SECURITY';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildEmailHtml({
  template,
  title,
  message,
  bannerImageUrl,
  logoUrl,
}: {
  template: EmailTemplateType;
  title: string;
  message: string;
  bannerImageUrl: string | null;
  logoUrl: string | null;
}) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br/>');
  const logoBlock = logoUrl
    ? `
      <div style="margin:0 0 14px 0;text-align:center;">
        <img src="${logoUrl}" alt="Brand logo" style="height:48px;max-width:180px;object-fit:contain;" />
      </div>
    `
    : '';
  const bannerBlock = bannerImageUrl
    ? `
      <div style="margin:14px 0;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <img src="${bannerImageUrl}" alt="Banner" style="display:block;width:100%;height:auto;object-fit:cover;" />
      </div>
    `
    : '';

  const getTheme = () => {
    if (template === 'PROMOTION') return { accent: '#16a34a', chip: '#dcfce7', heading: 'Special Offer' };
    if (template === 'MAINTENANCE') return { accent: '#ea580c', chip: '#ffedd5', heading: 'Service Update' };
    if (template === 'SECURITY') return { accent: '#dc2626', chip: '#fee2e2', heading: 'Security Alert' };
    return { accent: '#2563eb', chip: '#dbeafe', heading: 'General Update' };
  };

  const theme = getTheme();

  const footerNote =
    template === 'PROMOTION'
      ? 'Check the app for full details and limited-time offers.'
      : template === 'MAINTENANCE'
      ? 'We appreciate your patience during this maintenance window.'
      : template === 'SECURITY'
      ? 'If anything looks suspicious, contact support immediately.'
      : 'Thank you for staying updated with us.';

  return `
    <div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;background:#ffffff;">
      ${logoBlock}
      <div style="margin:0 0 10px 0;display:inline-block;padding:5px 10px;border-radius:999px;background:${theme.chip};color:${theme.accent};font-size:12px;font-weight:700;">
        ${theme.heading}
      </div>
      <h3 style="margin:8px 0 8px 0;font-size:22px;line-height:1.3;color:#111827;">${safeTitle}</h3>
      <p style="margin:0;color:#374151;font-size:14px;line-height:1.7;">${safeMessage}</p>
      ${bannerBlock}
      <p style="margin:12px 0 0 0;color:#4b5563;font-size:13px;">${footerNote}</p>
    </div>
  `;
}

async function uploadImageFromFile(file: File, folder: string) {
  if (!file.type?.startsWith('image/')) {
    throw new Error('Please upload a valid image file');
  }
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  if (!buffer.length) {
    throw new Error('Selected image is empty');
  }
  const mimeType = file.type && file.type.startsWith('image/') ? file.type : 'image/png';
  const base64 = buffer.toString('base64');
  const dataURI = `data:${mimeType};base64,${base64}`;
  return cloudinary.uploader.upload(dataURI, {
    folder,
    resource_type: 'image',
    format: 'png',
    quality: 'auto:best',
  });
}

export async function GET(req: NextRequest) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json(
        { error: adminAuth.error },
        { status: adminAuth.status },
      );
    }

    const items = await prisma.broadcastNotification.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });
    const notificationsWithMetrics = await Promise.all(
      items.map(async (item) => {
        try {
          const metricsRows = await prisma.$queryRaw<
            Array<{
              targetUsers: number;
              readUsers: number;
              targetDevices: number;
              readDevices: number;
            }>
          >`
            SELECT
              COUNT(DISTINCT un."userId")::int AS "targetUsers",
              COUNT(DISTINCT CASE WHEN un."isRead" = true THEN un."userId" END)::int AS "readUsers",
              COUNT(DISTINCT upt."id")::int AS "targetDevices",
              COUNT(DISTINCT CASE WHEN un."isRead" = true THEN upt."id" END)::int AS "readDevices"
            FROM "UserNotification" un
            LEFT JOIN "UserPushToken" upt
              ON upt."userId" = un."userId"
              AND upt."isActive" = true
            WHERE un."metadata"->>'broadcastId' = ${item.id}
          `;

          const metrics = metricsRows[0] || {
            targetUsers: 0,
            readUsers: 0,
            targetDevices: 0,
            readDevices: 0,
          };

          return {
            ...item,
            metrics: {
              targetUsers: Number(metrics.targetUsers || 0),
              readUsers: Number(metrics.readUsers || 0),
              unreadUsers: Math.max(
                Number(metrics.targetUsers || 0) - Number(metrics.readUsers || 0),
                0,
              ),
              targetDevices: Number(metrics.targetDevices || 0),
              readDevices: Number(metrics.readDevices || 0),
            },
          };
        } catch (metricsError) {
          console.error('Broadcast metrics query error:', metricsError);
          return {
            ...item,
            metrics: {
              targetUsers: 0,
              readUsers: 0,
              unreadUsers: 0,
              targetDevices: 0,
              readDevices: 0,
            },
          };
        }
      }),
    );

    return NextResponse.json({ notifications: notificationsWithMetrics });
  } catch (error) {
    console.error('Admin broadcast list error:', error);
    return NextResponse.json({ error: 'Failed to fetch broadcast notifications' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json(
        { error: adminAuth.error },
        { status: adminAuth.status },
      );
    }

    const formData = await req.formData();
    const title = String(formData.get('title') || '').trim();
    const message = String(formData.get('message') || '').trim();
    const rawType = String(formData.get('type') || 'NORMAL').trim().toUpperCase();
    const type =
      rawType === 'BANNER' || rawType === 'POPUP' ? rawType : 'NORMAL';
    const bannerFile = formData.get('banner') as File | null;
    const rawTarget = String(formData.get('target') || 'ALL').trim().toUpperCase();
    const target = rawTarget === 'SELECTED' ? 'SELECTED' : 'ALL';
    const sendEmailFlag = String(formData.get('sendEmail') || 'false').trim() === 'true';
    const rawDeliveryMode = String(formData.get('deliveryMode') || 'NOTIFICATION_AND_EMAIL')
      .trim()
      .toUpperCase();
    const deliveryMode =
      rawDeliveryMode === 'EMAIL_ONLY' ? 'EMAIL_ONLY' : 'NOTIFICATION_AND_EMAIL';
    const rawEmailTemplate = String(formData.get('emailTemplate') || 'GENERAL')
      .trim()
      .toUpperCase();
    const emailTemplate: EmailTemplateType =
      rawEmailTemplate === 'PROMOTION' ||
      rawEmailTemplate === 'MAINTENANCE' ||
      rawEmailTemplate === 'SECURITY'
        ? rawEmailTemplate
        : 'GENERAL';
    const selectedUserIdsRaw = String(formData.get('selectedUserIds') || '[]');
    const emailLogoFile = formData.get('emailLogo') as File | null;
    const allowDontShowAgain =
      String(formData.get('allowDontShowAgain') || 'true').trim() !== 'false';

    if (!title || !message) {
      return NextResponse.json({ error: 'Title and message are required' }, { status: 400 });
    }

    let bannerImageUrl: string | null = null;
    let emailLogoUrl: string | null = null;
    if (type === 'BANNER' || type === 'POPUP') {
      if (!bannerFile) {
        if (type === 'BANNER') {
          return NextResponse.json(
            { error: 'Banner image is required for banner type' },
            { status: 400 },
          );
        }
      } else {
        try {
          const uploaded = await uploadImageFromFile(
            bannerFile,
            'notification_banners',
          );
          bannerImageUrl = uploaded.secure_url;
        } catch (uploadError: any) {
          const uploadMsg = uploadError?.message || 'Invalid image file';
          return NextResponse.json(
            { error: `Banner upload failed: ${uploadMsg}` },
            { status: 400 },
          );
        }
      }
    }

    if (emailLogoFile) {
      try {
        const logoUploaded = await uploadImageFromFile(
          emailLogoFile,
          'notification_email_logos',
        );
        emailLogoUrl = logoUploaded.secure_url;
      } catch (uploadError: any) {
        const uploadMsg = uploadError?.message || 'Invalid image file';
        return NextResponse.json(
          { error: `Logo upload failed: ${uploadMsg}` },
          { status: 400 },
        );
      }
    }

    let selectedUserIds: string[] = [];
    if (target === 'SELECTED') {
      try {
        const parsed = JSON.parse(selectedUserIdsRaw);
        if (Array.isArray(parsed)) {
          selectedUserIds = parsed
            .map((id) => String(id || '').trim())
            .filter(Boolean);
        }
      } catch {
        selectedUserIds = [];
      }
      if (selectedUserIds.length === 0) {
        return NextResponse.json(
          { error: 'Please select at least one user for selected target' },
          { status: 400 },
        );
      }
    }

    const shouldSendNotification = deliveryMode !== 'EMAIL_ONLY';
    const shouldSendEmail = sendEmailFlag || deliveryMode === 'EMAIL_ONLY';

    const record = await prisma.broadcastNotification.create({
      data: {
        title,
        message,
        type,
        bannerImageUrl,
        target,
        showAsPopup: type === 'POPUP',
        allowDontShowAgain,
        createdByUserId: adminAuth.user.id,
      },
    });

    let stored: { count: number } = { count: 0 };
    let pushResult: any = { sent: 0 };
    let emailResult: any = { success: true, sentTo: 0 };

    if (target === 'ALL') {
      if (shouldSendNotification) {
        stored = await createNotificationForAllUsers({
          category: 'BROADCAST',
          title,
          message,
          imageUrl: bannerImageUrl,
          metadata: {
            broadcastId: record.id,
            type,
            showAsPopup: record.showAsPopup,
            allowDontShowAgain: record.allowDontShowAgain,
          },
        });

        pushResult = await sendPushToAllUsers({
          title,
          body: message,
          imageUrl: bannerImageUrl || undefined,
          data: {
            type: 'broadcast',
            notificationType: type.toLowerCase(),
            notificationId: record.id,
          },
        });
      } else {
        pushResult = { sent: 0, skipped: true, reason: 'EMAIL_ONLY_MODE' };
      }

      if (shouldSendEmail) {
        const allEmails = await prisma.user.findMany({
          select: { email: true },
        });
        const emails = allEmails
          .map((row) => row.email)
          .filter((email): email is string => Boolean(email));
        const emailSend = await sendEmailMany(
          emails,
          title,
          buildEmailHtml({
            template: emailTemplate,
            title,
            message,
            bannerImageUrl,
            logoUrl: emailLogoUrl,
          }),
        );
        emailResult = {
          ...emailSend,
          sentTo: emails.length,
        };
      }
    } else {
      const users = await prisma.user.findMany({
        where: { id: { in: selectedUserIds } },
        select: { id: true, email: true },
      });
      const userIds = users.map((u) => u.id);

      if (shouldSendNotification) {
        const created = await prisma.userNotification.createMany({
          data: userIds.map((userId) => ({
            userId,
            category: 'BROADCAST',
            title,
            message,
            imageUrl: bannerImageUrl || undefined,
            metadata: {
              broadcastId: record.id,
              type,
              target: 'SELECTED',
              showAsPopup: record.showAsPopup,
              allowDontShowAgain: record.allowDontShowAgain,
            },
          })),
        });
        stored = { count: created.count };

        const pushResults = await Promise.allSettled(
          userIds.map((userId) =>
            sendPushToUser(userId, {
              title,
              body: message,
              imageUrl: bannerImageUrl || undefined,
              data: {
                type: 'broadcast',
                notificationType: type.toLowerCase(),
                notificationId: record.id,
                target: 'selected',
              },
              persist: false,
            }),
          ),
        );
        const sent = pushResults.reduce((sum, row) => {
          if (row.status !== 'fulfilled') return sum;
          return sum + Number((row.value as any)?.sent || 0);
        }, 0);
        pushResult = { sent, attemptedUsers: userIds.length };
      } else {
        pushResult = { sent: 0, skipped: true, reason: 'EMAIL_ONLY_MODE' };
      }

      if (shouldSendEmail) {
        const emails = users
          .map((row) => row.email)
          .filter((email): email is string => Boolean(email));
        const emailSend = await sendEmailMany(
          emails,
          title,
          buildEmailHtml({
            template: emailTemplate,
            title,
            message,
            bannerImageUrl,
            logoUrl: emailLogoUrl,
          }),
        );
        emailResult = {
          ...emailSend,
          sentTo: emails.length,
        };
      }
    }

    return NextResponse.json({
      notification: record,
      pushResult,
      stored,
      emailResult,
      mode: deliveryMode,
      emailTemplate,
    });
  } catch (error) {
    console.error('Admin broadcast send error:', error);
    return NextResponse.json({ error: 'Failed to send broadcast notification' }, { status: 500 });
  }
}
