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

    const tournament = await prisma.tournament.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        title: true,
        checkinOpenAt: true,
        checkinCloseAt: true,
        startTime: true,
        status: true,
      },
    });
    if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });

    const registrations = await prisma.tournamentRegistration.findMany({
      where: { tournamentId: params.id, status: { in: ['APPROVED', 'CHECKED_IN', 'NO_SHOW'] } },
      include: {
        user: { select: { id: true, name: true, email: true } },
        team: { select: { id: true, name: true } },
      },
      orderBy: [{ checkedInAt: 'asc' }, { createdAt: 'asc' }],
    });

    const summary = {
      approved: registrations.filter((r) => r.status === 'APPROVED').length,
      checkedIn: registrations.filter((r) => r.checkinStatus === 'CHECKED_IN').length,
      noShow: registrations.filter((r) => r.status === 'NO_SHOW').length,
      total: registrations.length,
    };

    return NextResponse.json({ tournament, summary, registrations });
  } catch (error) {
    console.error('Admin checkin monitor error:', error);
    return NextResponse.json({ error: 'Failed to fetch check-in monitor' }, { status: 500 });
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

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').toLowerCase();

    if (action === 'close_and_mark_no_shows') {
      const result = await prisma.tournamentRegistration.updateMany({
        where: {
          tournamentId: params.id,
          status: { in: ['APPROVED'] },
          checkinStatus: { not: 'CHECKED_IN' },
        },
        data: {
          status: 'NO_SHOW',
          checkinStatus: 'NO_SHOW',
        },
      });
      return NextResponse.json({ updated: result.count });
    }

    if (action === 'reopen_registration_checkin') {
      const registrationId = String(body.registrationId || '');
      if (!registrationId) return NextResponse.json({ error: 'registrationId required' }, { status: 400 });
      const reg = await prisma.tournamentRegistration.update({
        where: { id: registrationId },
        data: { status: 'APPROVED', checkinStatus: 'PENDING', checkedInAt: null },
      });
      return NextResponse.json({ registration: reg });
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (error) {
    console.error('Admin checkin action error:', error);
    return NextResponse.json({ error: 'Failed to perform check-in action' }, { status: 500 });
  }
}
