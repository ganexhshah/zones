import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

function generateInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { searchParams } = new URL(req.url);
    const tournamentId = searchParams.get('tournamentId');

    const teams = await prisma.team.findMany({
      where: {
        ...(tournamentId ? { tournamentId } : {}),
        OR: [
          { captainId: auth.user.id },
          { members: { some: { userId: auth.user.id } } },
        ],
      },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ teams });
  } catch (error) {
    console.error('List teams error:', error);
    return NextResponse.json({ error: 'Failed to fetch teams' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    const type = String(body.type || 'DUO').toUpperCase();
    const region = body.region ? String(body.region).trim() : null;
    const tournamentId = body.tournamentId ? String(body.tournamentId) : null;

    if (!name) return NextResponse.json({ error: 'Team name is required' }, { status: 400 });
    if (!['DUO', 'SQUAD'].includes(type)) {
      return NextResponse.json({ error: 'Team type must be DUO or SQUAD' }, { status: 400 });
    }

    const team = await prisma.$transaction(async (tx) => {
      const created = await tx.team.create({
        data: {
          name,
          type,
          region,
          tournamentId,
          captainId: auth.user.id,
          inviteCode: generateInviteCode(),
        },
      });
      await tx.teamMember.create({
        data: {
          teamId: created.id,
          userId: auth.user.id,
          role: 'CAPTAIN',
          status: 'ACTIVE',
        },
      });
      return created;
    });

    return NextResponse.json({ team }, { status: 201 });
  } catch (error: any) {
    console.error('Create team error:', error);
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'Invite code conflict, retry' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create team' }, { status: 500 });
  }
}
