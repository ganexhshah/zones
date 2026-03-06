import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get('limit') || '20', 10)),
    );
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const search = (searchParams.get('search') || '').trim();
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) {
      where.status = status;
    }
    if (type) {
      const parsedTypes = type
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      if (parsedTypes.length === 1) {
        where.type = parsedTypes[0];
      } else if (parsedTypes.length > 1) {
        where.type = { in: parsedTypes };
      }
    }
    if (search) {
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
        {
          user: {
            is: {
              email: { contains: search, mode: 'insensitive' },
            },
          },
        },
        {
          user: {
            is: {
              name: { contains: search, mode: 'insensitive' },
            },
          },
        },
      ];
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
        },
      }),
      prisma.transaction.count({ where }),
    ]);

    return NextResponse.json({
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}

