import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthPayload } from '@/lib/route-auth';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuthPayload(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const data: any = {};

    if (body.roomId !== undefined) data.roomId = body.roomId ? String(body.roomId) : null;
    if (body.roomPass !== undefined) data.roomPass = body.roomPass ? String(body.roomPass) : null;
    if (body.status !== undefined) data.status = String(body.status).toUpperCase();
    if (body.scheduledAt !== undefined) {
      data.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
      if (data.scheduledAt && Number.isNaN(data.scheduledAt.getTime())) {
        return NextResponse.json({ error: 'Invalid scheduledAt' }, { status: 400 });
      }
    }

    if (body.metadata !== undefined && typeof body.metadata === 'object') {
      data.metadata = body.metadata;
    }

    const match = await prisma.tournamentMatch.update({
      where: { id: params.id },
      data,
    });

    return NextResponse.json({ match });
  } catch (error: any) {
    console.error('Admin update match error:', error);
    if (error?.code === 'P2025') {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to update match' }, { status: 500 });
  }
}
