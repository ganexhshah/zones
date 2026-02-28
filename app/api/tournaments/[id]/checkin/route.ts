import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

function inWindow(now: Date, openAt?: Date | null, closeAt?: Date | null) {
  if (openAt && now < openAt) return false;
  if (closeAt && now > closeAt) return false;
  return true;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const tournament = await prisma.tournament.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        title: true,
        checkinOpenAt: true,
        checkinCloseAt: true,
        startTime: true,
      },
    });
    if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });

    const reg = await prisma.tournamentRegistration.findFirst({
      where: {
        tournamentId: params.id,
        OR: [
          { userId: auth.user.id },
          { team: { members: { some: { userId: auth.user.id, status: 'ACTIVE' } } } },
        ],
      },
      include: {
        team: { select: { id: true, name: true, captainId: true } },
      },
    });
    if (!reg) return NextResponse.json({ error: 'Registration not found' }, { status: 404 });

    const now = new Date();
    return NextResponse.json({
      tournament,
      registration: reg,
      canCheckIn: inWindow(now, tournament.checkinOpenAt, tournament.checkinCloseAt) && ['APPROVED', 'CHECKED_IN'].includes(reg.status),
      now,
    });
  } catch (error) {
    console.error('Get checkin status error:', error);
    return NextResponse.json({ error: 'Failed to get check-in status' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const tournament = await prisma.tournament.findUnique({ where: { id: params.id } });
    if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });

    const reg = await prisma.tournamentRegistration.findFirst({
      where: {
        tournamentId: params.id,
        OR: [
          { userId: auth.user.id },
          { team: { members: { some: { userId: auth.user.id, status: 'ACTIVE' } } } },
        ],
      },
      include: { team: { select: { captainId: true } } },
    });
    if (!reg) return NextResponse.json({ error: 'Registration not found' }, { status: 404 });

    if (reg.teamId && reg.team?.captainId !== auth.user.id) {
      return NextResponse.json({ error: 'Only team captain can check in the team' }, { status: 403 });
    }
    if (!['APPROVED', 'CHECKED_IN'].includes(reg.status)) {
      return NextResponse.json({ error: 'Registration is not eligible for check-in' }, { status: 400 });
    }

    const now = new Date();
    if (!inWindow(now, tournament.checkinOpenAt, tournament.checkinCloseAt)) {
      return NextResponse.json({ error: 'Check-in window is closed' }, { status: 400 });
    }

    const updated = await prisma.tournamentRegistration.update({
      where: { id: reg.id },
      data: {
        status: 'CHECKED_IN',
        checkinStatus: 'CHECKED_IN',
        checkedInAt: now,
      },
    });

    return NextResponse.json({ registration: updated });
  } catch (error) {
    console.error('Checkin error:', error);
    return NextResponse.json({ error: 'Failed to check in' }, { status: 500 });
  }
}
