import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthPayload } from '@/lib/route-auth';

const ALLOWED_STATUSES = new Set(['OPEN', 'ACTIVE', 'FULL', 'CLOSED']);

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuthPayload(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const status = String(body.status || '').toUpperCase();

    if (!ALLOWED_STATUSES.has(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const existing = await prisma.customMatch.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: 'Match not found' }, { status: 404 });

    const match = await prisma.customMatch.update({
      where: { id: params.id },
      data: { status },
    });

    return NextResponse.json({ match });
  } catch (error) {
    console.error('Admin custom match status update error:', error);
    return NextResponse.json({ error: 'Failed to update match status' }, { status: 500 });
  }
}
