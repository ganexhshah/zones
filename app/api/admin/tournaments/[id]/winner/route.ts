import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';
import { sendPushToUser } from '@/lib/push';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const tournamentId = params.id;
    const body = await req.json().catch(() => ({}));
    const winnerUserId = String(body.winnerUserId || '').trim();

    if (!winnerUserId) {
      return NextResponse.json({ error: 'Winner user ID is required' }, { status: 400 });
    }

    // Get tournament with participants
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        participants: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!tournament) {
      return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
    }

    // Verify winner is a participant
    const winnerParticipant = tournament.participants.find(p => p.userId === winnerUserId);
    if (!winnerParticipant) {
      return NextResponse.json({ error: 'Winner must be a registered participant' }, { status: 400 });
    }

    // Update tournament with winner and mark as completed
    const updatedTournament = await prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        status: 'completed',
      },
    });

    // Update winner's participant record
    await prisma.tournamentParticipant.update({
      where: { id: winnerParticipant.id },
      data: {
        rank: 1,
        prize: tournament.prizePool,
      },
    });

    // Award prize to winner's wallet
    await prisma.user.update({
      where: { id: winnerUserId },
      data: {
        walletBalance: {
          increment: tournament.prizePool,
        },
      },
    });

    // Create transaction record
    await prisma.transaction.create({
      data: {
        userId: winnerUserId,
        type: 'TOURNAMENT_WIN',
        amount: tournament.prizePool,
        status: 'completed',
        reference: `tournament:${tournamentId}`,
        method: 'wallet',
      },
    });

    // Send notifications to winner
    await sendPushToUser(winnerUserId, {
      title: '🏆 Congratulations!',
      body: `You won ${tournament.title}! Rs ${tournament.prizePool.toFixed(2)} has been added to your wallet.`,
      data: {
        type: 'TOURNAMENT_WIN',
        tournamentId: tournamentId,
        prize: tournament.prizePool.toString(),
      },
    });

    // Send notifications to all other participants
    const otherParticipants = tournament.participants.filter(p => p.userId !== winnerUserId);
    for (const participant of otherParticipants) {
      await sendPushToUser(participant.userId, {
        title: 'Tournament Completed',
        body: `${tournament.title} has ended. Winner: ${winnerParticipant.user.name || 'Unknown'}`,
        data: {
          type: 'TOURNAMENT_COMPLETED',
          tournamentId: tournamentId,
          winnerId: winnerUserId,
        },
      });
    }

    return NextResponse.json({
      success: true,
      tournament: updatedTournament,
      winner: {
        userId: winnerUserId,
        name: winnerParticipant.user.name,
        prize: tournament.prizePool,
      },
    });
  } catch (error: any) {
    console.error('Declare tournament winner error:', error);
    return NextResponse.json({ error: 'Failed to declare winner' }, { status: 500 });
  }
}
