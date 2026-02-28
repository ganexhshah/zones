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

    // Only allow cancellation if match is OPEN or ACTIVE
    if (match.status !== 'OPEN' && match.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Cannot cancel match in current status' }, { status: 400 });
    }

    // Refund entry fees to all participants
    const refundPromises = match.participants.map(async (participant) => {
      return prisma.user.update({
        where: { id: participant.userId },
        data: {
          walletBalance: {
            increment: match.entryFee,
          },
        },
      });
    });

    await Promise.all(refundPromises);

    // Update match status to CLOSED
    const updatedMatch = await prisma.customMatch.update({
      where: { id: params.id },
      data: { status: 'CLOSED' },
    });

    return NextResponse.json({ 
      match: updatedMatch,
      refundedPlayers: match.participants.length,
      refundAmount: match.entryFee,
    });
  } catch (error) {
    console.error('Admin custom match cancel error:', error);
    return NextResponse.json({ error: 'Failed to cancel match' }, { status: 500 });
  }
}
