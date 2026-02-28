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
    const status = body.status ? String(body.status).toUpperCase() : undefined;
    const resolutionNote = body.resolutionNote ? String(body.resolutionNote).trim() : undefined;

    const data: any = {};
    if (status) data.status = status;
    if (resolutionNote !== undefined) data.resolutionNote = resolutionNote;
    if (['RESOLVED', 'REJECTED'].includes(status || '')) {
      data.resolvedAt = new Date();
      data.resolvedByUserId = auth.payload.userId;
    }

    const dispute = await prisma.tournamentDispute.update({
      where: { id: params.id },
      data,
    });

    return NextResponse.json({ dispute });
  } catch (error: any) {
    console.error('Admin dispute update error:', error);
    if (error?.code === 'P2025') return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    return NextResponse.json({ error: 'Failed to update dispute' }, { status: 500 });
  }
}
