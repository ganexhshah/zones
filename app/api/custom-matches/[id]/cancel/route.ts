import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthPayload } from '@/lib/route-auth';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuthPayload(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const match = await prisma.customMatch.findUnique({
      where: { id: params.id },
      include: {
        participants: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    }

    // Only the creator can cancel their own match
    if (match.createdByUserId !== auth.payload.userId) {
      return NextResponse.json({ error: 'Only the match creator can cancel this match' }, { status: 403 });
    }

    // Only allow cancellation if match is OPEN or ACTIVE
    if (match.status !== 'OPEN' && match.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Cannot cancel match in current status' }, { status: 400 });
    }

    const updatedMatch = await prisma.$transaction(async (tx) => {
      // Refund entry fees to all participants.
      await Promise.all(
        match.participants.map(async (participant) => {
          await tx.user.update({
            where: { id: participant.userId },
            data: {
              walletBalance: {
                increment: match.entryFee,
              },
            },
          });

          if (match.entryFee > 0) {
            await tx.transaction.create({
              data: {
                userId: participant.userId,
                type: 'custom_match_refund',
                amount: match.entryFee,
                method: 'wallet',
                status: 'completed',
                reference: `custom_match_cancel:${match.id}`,
              },
            });
          }
        })
      );

      // A cancelled match should not expose room credentials or pending/past results.
      await tx.customMatchResultSubmission.deleteMany({
        where: { customMatchId: params.id },
      });

      return tx.customMatch.update({
        where: { id: params.id },
        data: {
          status: 'CLOSED',
          roomId: null,
          roomPassword: null,
        },
      });
    });

    return NextResponse.json({ 
      match: updatedMatch,
      refundedPlayers: match.participants.length,
      refundAmount: match.entryFee,
      message: 'Match cancelled successfully and entry fees refunded',
    });
  } catch (error) {
    console.error('Custom match cancel error:', error);
    return NextResponse.json({ error: 'Failed to cancel match' }, { status: 500 });
  }
}
