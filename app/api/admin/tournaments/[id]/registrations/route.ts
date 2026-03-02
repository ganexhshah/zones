import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';
import { requireAuthPayload } from '@/lib/route-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const auth = requireAuthPayload(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const checkinStatus = searchParams.get('checkinStatus');

    const registrations = await prisma.tournamentRegistration.findMany({
      where: {
        tournamentId: params.id,
        ...(status ? { status } : {}),
        ...(checkinStatus ? { checkinStatus } : {}),
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        team: {
          select: {
            id: true,
            name: true,
            captainId: true,
            members: { select: { id: true, userId: true, role: true, status: true } },
          },
        },
      },
      orderBy: [{ seed: 'asc' }, { createdAt: 'asc' }],
    });

    return NextResponse.json({ registrations });
  } catch (error) {
    console.error('Admin registrations list error:', error);
    return NextResponse.json({ error: 'Failed to fetch registrations' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const auth = requireAuthPayload(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json();
    const registrationId = String(body.registrationId || '');
    const action = String(body.action || '').toLowerCase();
    const seed = body.seed == null || body.seed === '' ? null : Number(body.seed);

    if (!registrationId || !action) {
      return NextResponse.json({ error: 'registrationId and action are required' }, { status: 400 });
    }

    const reg = await prisma.tournamentRegistration.findFirst({
      where: { id: registrationId, tournamentId: params.id },
    });
    if (!reg) return NextResponse.json({ error: 'Registration not found' }, { status: 404 });

    const data: any = {};
    if (action === 'approve') {
      data.status = reg.checkinStatus === 'CHECKED_IN' ? 'CHECKED_IN' : 'APPROVED';
      data.approvedAt = new Date();
      if (body.paid !== undefined) data.paid = Boolean(body.paid);
    } else if (action === 'reject') {
      data.status = 'REJECTED';
      data.checkinStatus = 'PENDING';
    } else if (action === 'disqualify') {
      data.status = 'DISQUALIFIED';
    } else if (action === 'set_seed') {
      if (seed == null || !Number.isInteger(seed) || seed <= 0) {
        return NextResponse.json({ error: 'Invalid seed' }, { status: 400 });
      }
      data.seed = seed;
    } else {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }

    if (seed != null && action !== 'set_seed') data.seed = seed;

    const updated = await prisma.tournamentRegistration.update({
      where: { id: registrationId },
      data,
    });

    return NextResponse.json({ registration: updated });
  } catch (error) {
    console.error('Admin registration action error:', error);
    return NextResponse.json({ error: 'Failed to update registration' }, { status: 500 });
  }
}
