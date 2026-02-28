import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthPayload } from '@/lib/route-auth';

export async function GET(req: NextRequest) {
  try {
    const auth = requireAuthPayload(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { searchParams } = new URL(req.url);
    const status = (searchParams.get('status') || '').toUpperCase();
    const search = (searchParams.get('search') || '').trim();

    const matches = await prisma.customMatch.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: 'insensitive' } },
                { roomType: { contains: search, mode: 'insensitive' } },
                { mode: { contains: search, mode: 'insensitive' } },
                { createdBy: { name: { contains: search, mode: 'insensitive' } } },
                { createdBy: { email: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        participants: {
          select: {
            id: true,
            userId: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
        joinRequests: {
          where: { status: 'PENDING' },
          select: {
            id: true,
            status: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ matches });
  } catch (error) {
    console.error('Admin custom matches list error:', error);
    const err = error as { code?: string };
    if (err?.code === 'P2021' || err?.code === 'P2022') {
      return NextResponse.json(
        { error: 'Database schema is outdated. Run: npx prisma db push' },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: 'Failed to fetch custom matches' }, { status: 500 });
  }
}
