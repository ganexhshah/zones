import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

const TEAM_LIMITS: Record<string, number> = { DUO: 2, SQUAD: 4 };

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const inviteCode = String(body.inviteCode || '').trim().toUpperCase();
    if (!inviteCode) return NextResponse.json({ error: 'Invite code is required' }, { status: 400 });

    const team = await prisma.team.findUnique({
      where: { inviteCode },
      include: { members: true },
    });
    if (!team) return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 });

    const activeMembers = team.members.filter((m) => m.status === 'ACTIVE');
    if (activeMembers.some((m) => m.userId === auth.user.id)) {
      return NextResponse.json({ error: 'Already in team' }, { status: 400 });
    }
    const maxSize = TEAM_LIMITS[team.type] || 4;
    if (activeMembers.length >= maxSize) {
      return NextResponse.json({ error: 'Team is full' }, { status: 400 });
    }

    const member = await prisma.teamMember.create({
      data: {
        teamId: team.id,
        userId: auth.user.id,
        role: 'MEMBER',
        status: 'ACTIVE',
      },
    });

    return NextResponse.json({ member });
  } catch (error: any) {
    console.error('Join team error:', error);
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'Already joined' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to join team' }, { status: 500 });
  }
}
