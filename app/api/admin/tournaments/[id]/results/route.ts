import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthPayload } from '@/lib/route-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuthPayload(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { searchParams } = new URL(req.url);
    const verifiedStatus = searchParams.get('verifiedStatus');

    const results = await prisma.matchResultSubmission.findMany({
      where: {
        match: { tournamentId: params.id },
        ...(verifiedStatus ? { verifiedStatus } : {}),
      },
      include: {
        match: true,
        registration: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            team: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ verifiedStatus: 'asc' }, { submittedAt: 'desc' }],
    });

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Admin list results error:', error);
    return NextResponse.json({ error: 'Failed to fetch results' }, { status: 500 });
  }
}
