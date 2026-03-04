import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest) {
  try {
    const authResult = await requireAuthUser(req);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const userId = authResult.user.id;
    const deletedEmail = `deleted_${Date.now()}_${userId}@deleted.local`;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          email: deletedEmail,
          phone: null,
          name: 'Deleted User',
          avatar: null,
          password: null,
          passwordHash: null,
          googleId: null,
          isBlocked: true,
          walletBalance: 0,
        },
      });

      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.userPushToken.deleteMany({ where: { userId } });
    });

    return NextResponse.json({
      success: true,
      message: 'Account deleted successfully',
    });
  } catch (error) {
    console.error('Delete account error:', error);
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
  }
}
