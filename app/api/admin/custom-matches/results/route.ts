import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthPayload } from '@/lib/route-auth';

export async function GET(req: NextRequest) {
  try {
    const auth = requireAuthPayload(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { searchParams } = new URL(req.url);
    const status = String(searchParams.get('status') || 'PENDING').toUpperCase();

    const submissions = await prisma.customMatchResultSubmission.findMany({
      where: { status },
      include: {
        customMatch: { select: { id: true, title: true, roomId: true, roomPassword: true, entryFee: true } },
        winner: { select: { id: true, name: true, walletBalance: true } },
        submittedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ submissions });
  } catch (error) {
    console.error('Admin custom result list error:', error);
    const err = error as { code?: string };
    if (err?.code === 'P2021' || err?.code === 'P2022') {
      return NextResponse.json(
        { error: 'Database schema is outdated. Run: npx prisma db push' },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: 'Failed to fetch result submissions' }, { status: 500 });
  }
}
