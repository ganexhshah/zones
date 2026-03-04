import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireAuthUser(req);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const rows = await prisma.userNotification.findMany({
      where: {
        userId: authResult.user.id,
        category: 'CUSTOM',
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        message: true,
        createdAt: true,
        metadata: true,
      },
    });

    const alerts = rows.map((row) => {
      const metadata =
        row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};

      return {
        id: row.id,
        type: typeof metadata.type === 'string' ? metadata.type : 'custom_update',
        title: row.title,
        message: row.message,
        createdAt: row.createdAt,
        metadata,
      };
    });

    return NextResponse.json({ alerts });
  } catch (error) {
    console.error('Custom match alerts error:', error);
    return NextResponse.json({ error: 'Failed to load custom match alerts' }, { status: 500 });
  }
}
