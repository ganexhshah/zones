import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { tournamentId } = await req.json();

    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { participants: true },
    });

    if (!tournament) {
      return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
    }

    if (tournament.participants.length >= tournament.maxPlayers) {
      return NextResponse.json({ error: 'Tournament is full' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });

    if (!user || user.walletBalance < tournament.entryFee) {
      return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const participant = await tx.tournamentParticipant.create({
        data: {
          userId: payload.userId,
          tournamentId,
        },
      });

      // Keep registration model in sync for lobby/match-result workflows.
      await tx.tournamentRegistration.upsert({
        where: {
          tournamentId_userId: {
            tournamentId,
            userId: payload.userId,
          },
        },
        update: {
          paid: true,
          status: 'APPROVED',
          approvedAt: new Date(),
        },
        create: {
          tournamentId,
          userId: payload.userId,
          paid: true,
          status: 'APPROVED',
          approvedAt: new Date(),
        },
      });

      await tx.user.update({
        where: { id: payload.userId },
        data: { walletBalance: user.walletBalance - tournament.entryFee },
      });

      await tx.transaction.create({
        data: {
          userId: payload.userId,
          type: 'tournament_entry',
          amount: -tournament.entryFee,
          status: 'completed',
          reference: tournamentId,
        },
      });

      return participant;
    });

    return NextResponse.json({ participant: result });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'Already joined' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to join tournament' }, { status: 500 });
  }
}
