import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

function newInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const team = await prisma.team.findUnique({
      where: { id: params.id },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    const isMember = team.members.some((m) => m.userId === auth.user.id);
    if (!isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    return NextResponse.json({ team });
  } catch (error) {
    console.error('Get team error:', error);
    return NextResponse.json({ error: 'Failed to fetch team' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const team = await prisma.team.findUnique({ where: { id: params.id } });
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    if (team.captainId !== auth.user.id) return NextResponse.json({ error: 'Only captain can update team' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const data: any = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.region !== undefined) data.region = body.region ? String(body.region).trim() : null;
    if (body.regenerateInviteCode === true) data.inviteCode = newInviteCode();

    const updated = await prisma.team.update({ where: { id: params.id }, data });
    return NextResponse.json({ team: updated });
  } catch (error: any) {
    console.error('Update team error:', error);
    if (error?.code === 'P2002') return NextResponse.json({ error: 'Invite code conflict, retry' }, { status: 409 });
    return NextResponse.json({ error: 'Failed to update team' }, { status: 500 });
  }
}
