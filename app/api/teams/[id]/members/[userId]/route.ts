import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; userId: string } }
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const team = await prisma.team.findUnique({ where: { id: params.id } });
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    const isCaptain = team.captainId === auth.user.id;
    const isSelf = auth.user.id === params.userId;
    if (!isCaptain && !isSelf) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (params.userId === team.captainId) return NextResponse.json({ error: 'Captain cannot be removed' }, { status: 400 });

    await prisma.teamMember.delete({
      where: { teamId_userId: { teamId: params.id, userId: params.userId } },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Remove member error:', error);
    if (error?.code === 'P2025') return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
  }
}
