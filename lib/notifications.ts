import { prisma } from '@/lib/prisma';

type NotificationInput = {
  userId: string;
  category?: string;
  title: string;
  message: string;
  metadata?: Record<string, any> | null;
  imageUrl?: string | null;
};

export async function createUserNotification(input: NotificationInput) {
  try {
    return await prisma.userNotification.create({
      data: {
        userId: input.userId,
        category: input.category || 'SYSTEM',
        title: input.title,
        message: input.message,
        metadata: input.metadata || undefined,
        imageUrl: input.imageUrl || undefined,
      },
    });
  } catch (error) {
    console.error('Create user notification error:', error);
    return null;
  }
}

export async function createNotificationForAllUsers(input: {
  category?: string;
  title: string;
  message: string;
  metadata?: Record<string, any> | null;
  imageUrl?: string | null;
}) {
  try {
    const users = await prisma.user.findMany({
      select: { id: true },
    });
    if (users.length === 0) return { count: 0 };

    const rows = users.map((u) => ({
      userId: u.id,
      category: input.category || 'SYSTEM',
      title: input.title,
      message: input.message,
      metadata: input.metadata || undefined,
      imageUrl: input.imageUrl || undefined,
    }));

    const created = await prisma.userNotification.createMany({
      data: rows,
    });

    return { count: created.count };
  } catch (error) {
    console.error('Create notification for all users error:', error);
    return { count: 0 };
  }
}
