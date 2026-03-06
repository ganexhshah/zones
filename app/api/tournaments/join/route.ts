import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';
import { sendPushToUser } from '@/lib/push';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { tournamentId } = await req.json();

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${auth.user.id} FOR UPDATE`;

      const tournament = await tx.tournament.findUnique({
        where: { id: tournamentId },
        select: { id: true, entryFee: true, maxPlayers: true },
      });
      if (!tournament) {
        throw Object.assign(new Error('Tournament not found'), { code: 'TOURNAMENT_NOT_FOUND' });
      }

      const participantCount = await tx.tournamentParticipant.count({
        where: { tournamentId },
      });
      if (participantCount >= tournament.maxPlayers) {
        throw Object.assign(new Error('Tournament is full'), { code: 'TOURNAMENT_FULL' });
      }

      const user = await tx.user.findUnique({
        where: { id: auth.user.id },
        select: { id: true, walletBalance: true },
      });
      if (!user || user.walletBalance < tournament.entryFee) {
        throw Object.assign(new Error('Insufficient balance'), { code: 'INSUFFICIENT_BALANCE' });
      }

      const participant = await tx.tournamentParticipant.create({
        data: {
          userId: auth.user.id,
          tournamentId,
        },
      });

      // Keep registration model in sync for lobby/match-result workflows.
      await tx.tournamentRegistration.upsert({
        where: {
          tournamentId_userId: {
            tournamentId,
            userId: auth.user.id,
          },
        },
        update: {
          paid: true,
          status: 'APPROVED',
          approvedAt: new Date(),
        },
        create: {
          tournamentId,
          userId: auth.user.id,
          paid: true,
          status: 'APPROVED',
          approvedAt: new Date(),
        },
      });

      await tx.user.update({
        where: { id: auth.user.id },
        data: {
          walletBalance: {
            decrement: tournament.entryFee,
          },
        },
      });

      await tx.transaction.create({
        data: {
          userId: auth.user.id,
          type: 'tournament_entry',
          amount: -tournament.entryFee,
          status: 'completed',
          reference: tournamentId,
        },
      });

      return { participant, entryFee: tournament.entryFee };
    });

    if (result.entryFee > 0) {
      await sendPushToUser(auth.user.id, {
        title: 'Entry Fee Deducted',
        body: `Rs ${result.entryFee.toFixed(2)} deducted for tournament entry.`,
        data: {
          type: 'tournament_entry',
          status: 'completed',
          tournamentId,
        },
      });
    }

    return NextResponse.json({ participant: result.participant });
  } catch (error: any) {
    if (error.code === 'TOURNAMENT_NOT_FOUND') {
      return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
    }
    if (error.code === 'TOURNAMENT_FULL') {
      return NextResponse.json({ error: 'Tournament is full' }, { status: 400 });
    }
    if (error.code === 'INSUFFICIENT_BALANCE') {
      return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 });
    }
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'Already joined' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to join tournament' }, { status: 500 });
  }
}
