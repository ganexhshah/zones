import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';
import { sendPushToUser } from '@/lib/push';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => ({}));
    const teamId = typeof body.teamId === 'string' ? body.teamId : null;

    const tournament = await prisma.tournament.findUnique({
      where: { id: params.id },
      include: {
        registrations: {
          where: { status: { not: 'REJECTED' } },
          select: { id: true },
        },
      },
    });
    if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });

    if (['cancelled', 'completed'].includes((tournament.status || '').toLowerCase())) {
      return NextResponse.json({ error: 'Tournament is not open for registration' }, { status: 400 });
    }

    if (tournament.registrations.length >= tournament.maxPlayers) {
      return NextResponse.json({ error: 'Tournament slots are full' }, { status: 400 });
    }

    let registrationUserId: string | null = auth.user.id;
    let registrationTeamId: string | null = null;
    let metadata: any = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};

    if (teamId) {
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: { members: true },
      });
      if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
      const activeMember = team.members.find((m) => m.userId === auth.user.id && m.status === 'ACTIVE');
      if (!activeMember) return NextResponse.json({ error: 'You are not an active member of this team' }, { status: 403 });

      registrationUserId = null;
      registrationTeamId = team.id;
      metadata = { ...metadata, registeredByUserId: auth.user.id };
    }

    const txResult = await prisma.$transaction(async (tx) => {
      const existing = await tx.tournamentRegistration.findFirst({
        where: {
          tournamentId: params.id,
          OR: [
            registrationUserId ? { userId: registrationUserId } : undefined,
            registrationTeamId ? { teamId: registrationTeamId } : undefined,
          ].filter(Boolean) as any,
        },
      });
      if (existing) {
        throw new Error('ALREADY_REGISTERED');
      }

      let paid = tournament.entryFee <= 0;
      if (tournament.entryFee > 0) {
        if (auth.user.walletBalance < tournament.entryFee) {
          throw new Error('INSUFFICIENT_BALANCE');
        }
        await tx.user.update({
          where: { id: auth.user.id },
          data: { walletBalance: { decrement: tournament.entryFee } },
        });
        await tx.transaction.create({
          data: {
            userId: auth.user.id,
            type: 'ENTRY_FEE',
            amount: -tournament.entryFee,
            status: 'completed',
            reference: `tournament:${params.id}`,
            method: 'wallet',
          },
        });
        paid = true;
      }

      const reg = await tx.tournamentRegistration.create({
        data: {
          tournamentId: params.id,
          userId: registrationUserId,
          teamId: registrationTeamId,
          paid,
          status: 'APPROVED',
          metadata,
        },
      });

      return reg;
    });

    if (tournament.entryFee > 0) {
      await sendPushToUser(auth.user.id, {
        title: 'Entry Fee Deducted',
        body: `Rs ${tournament.entryFee.toFixed(2)} deducted for tournament registration.`,
        data: {
          type: 'ENTRY_FEE',
          status: 'completed',
          tournamentId: params.id,
        },
      });
    }

    return NextResponse.json({ registration: txResult }, { status: 201 });
  } catch (error: any) {
    if (error?.message === 'ALREADY_REGISTERED') {
      return NextResponse.json({ error: 'Already registered' }, { status: 400 });
    }
    if (error?.message === 'INSUFFICIENT_BALANCE') {
      return NextResponse.json({ error: 'Insufficient wallet balance' }, { status: 400 });
    }
    console.error('Tournament registration error:', error);
    return NextResponse.json({ error: 'Failed to register for tournament' }, { status: 500 });
  }
}
