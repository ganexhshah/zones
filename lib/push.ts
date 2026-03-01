import { prisma } from '@/lib/prisma';
import { getFirebaseMessaging } from '@/lib/firebase-admin';
import { createUserNotification } from '@/lib/notifications';

type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
  category?: string;
  persist?: boolean;
};

async function sendWithTokens(
  tokens: Array<{ id: string; token: string }>,
  payload: PushPayload
) {
  const messaging = getFirebaseMessaging();
  if (!messaging) return { sent: 0, reason: 'firebase_not_configured' as const };
  if (tokens.length === 0) return { sent: 0, reason: 'no_tokens' as const };

  const invalidCodes = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
  ]);

  let sent = 0;
  let failed = 0;
  const inactiveIds: string[] = [];
  const chunkSize = 500;

  for (let i = 0; i < tokens.length; i += chunkSize) {
    const chunk = tokens.slice(i, i + chunkSize);
    const response = await messaging.sendEachForMulticast({
      tokens: chunk.map((t) => t.token),
      notification: {
        title: payload.title,
        body: payload.body,
        ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
      },
      data: payload.data,
      android: {
        priority: 'high',
        notification: payload.imageUrl ? { imageUrl: payload.imageUrl } : undefined,
      },
    });

    sent += response.successCount;
    failed += response.failureCount;

    response.responses.forEach((item, index) => {
      if (!item.success && item.error && invalidCodes.has(item.error.code)) {
        inactiveIds.push(chunk[index].id);
      }
    });
  }

  if (inactiveIds.length > 0) {
    await prisma.userPushToken.updateMany({
      where: { id: { in: inactiveIds } },
      data: { isActive: false },
    });
  }

  return { sent, failed };
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  try {
    if (payload.persist !== false) {
      const type = (payload.data?.type || '').toLowerCase();
      const derivedCategory =
        payload.category ||
        (type.includes('custom')
            ? 'CUSTOM'
            : type.includes('tournament')
            ? 'TOURNAMENT'
            : type.includes('wallet') ||
                  type.includes('withdraw') ||
                  type.includes('deposit') ||
                  type.includes('entry') ||
                  type.includes('refund') ||
                  type.includes('winning') ||
                  type.includes('admin_')
              ? 'WALLET'
              : type.includes('broadcast')
              ? 'BROADCAST'
              : 'SYSTEM');

      await createUserNotification({
        userId,
        category: derivedCategory,
        title: payload.title,
        message: payload.body,
        imageUrl: payload.imageUrl,
        metadata: payload.data || null,
      });
    }

    const tokens = await prisma.userPushToken.findMany({
      where: {
        userId,
        isActive: true,
      },
      select: {
        id: true,
        token: true,
      },
    });
    return sendWithTokens(tokens, payload);
  } catch (error) {
    console.error('Push send error:', error);
    return { sent: 0, reason: 'send_failed' as const };
  }
}

export async function sendPushToAllUsers(payload: PushPayload) {
  try {
    const tokens = await prisma.userPushToken.findMany({
      where: { isActive: true },
      select: { id: true, token: true },
    });
    return sendWithTokens(tokens, payload);
  } catch (error) {
    console.error('Push broadcast error:', error);
    return { sent: 0, reason: 'send_failed' as const };
  }
}
