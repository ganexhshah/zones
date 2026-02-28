import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; requestId: string } }
) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').toLowerCase();
    if (!['accept', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Action must be accept or reject' }, { status: 400 });
    }

    const match = await prisma.customMatch.findUnique({
      where: { id: params.id },
      include: { participants: { select: { userId: true } } },
    });
    if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    if (match.createdByUserId !== auth.user.id) {
      return NextResponse.json({ error: 'Only creator can review requests' }, { status: 403 });
    }
    if (!['OPEN', 'ACTIVE'].includes(match.status)) {
      return NextResponse.json({ error: 'Cannot review requests for closed match' }, { status: 400 });
    }

    const requestRow = await prisma.customMatchJoinRequest.findUnique({
      where: { id: params.requestId },
    });
    if (!requestRow || requestRow.customMatchId !== match.id) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }
    if (requestRow.status !== 'PENDING') {
      return NextResponse.json({ error: 'Request already reviewed' }, { status: 400 });
    }

    if (action === 'accept') {
      const roomId = String(body.roomId || '').trim();
      const roomPassword = String(body.roomPassword || '').trim();
      if (!roomId || !roomPassword) {
        return NextResponse.json({ error: 'roomId and roomPassword are required on accept' }, { status: 400 });
      }
      if (match.participants.length >= match.maxPlayers) {
        return NextResponse.json({ error: 'Match is full' }, { status: 400 });
      }

      const result = await prisma.$transaction(async (tx) => {
        const joinUser = await tx.user.findUnique({
          where: { id: requestRow.userId },
          select: { id: true, walletBalance: true },
        });
        if (!joinUser) {
          throw new Error('JOIN_USER_NOT_FOUND');
        }

        if (match.entryFee > 0 && joinUser.walletBalance < match.entryFee) {
          throw new Error('JOIN_USER_INSUFFICIENT_BALANCE');
        }

        const participants = await tx.customMatchParticipant.findMany({
          where: { customMatchId: match.id },
          orderBy: { slotNo: 'asc' },
        });
        const alreadyParticipant = participants.some((p) => p.userId === requestRow.userId);
        if (alreadyParticipant) {
          throw new Error('ALREADY_JOINED');
        }
        const nextSlot = (participants[participants.length - 1]?.slotNo || 0) + 1;

        await tx.customMatchJoinRequest.update({
          where: { id: requestRow.id },
          data: {
            status: 'ACCEPTED',
            reviewedByUserId: auth.user.id,
            reviewedAt: new Date(),
          },
        });

        await tx.customMatchParticipant.create({
          data: {
            customMatchId: match.id,
            userId: requestRow.userId,
            slotNo: nextSlot,
          },
        });

        if (match.entryFee > 0) {
          await tx.user.update({
            where: { id: requestRow.userId },
            data: { walletBalance: { decrement: match.entryFee } },
          });
          await tx.transaction.create({
            data: {
              userId: requestRow.userId,
              type: 'custom_match_entry_fee',
              amount: match.entryFee,
              method: 'wallet',
              status: 'completed',
              reference: `custom_match_join:${match.id}`,
            },
          });
        }

        const participantCount = participants.length + 1;
        const status = participantCount >= match.maxPlayers ? 'FULL' : 'ACTIVE';

        const updatedMatch = await tx.customMatch.update({
          where: { id: match.id },
          data: {
            roomId,
            roomPassword,
            status,
          },
        });
        return updatedMatch;
      });

      return NextResponse.json({ match: result });
    }

    const reviewed = await prisma.customMatchJoinRequest.update({
      where: { id: requestRow.id },
      data: {
        status: 'REJECTED',
        reviewedByUserId: auth.user.id,
        reviewedAt: new Date(),
      },
    });

    return NextResponse.json({ request: reviewed });
  } catch (error) {
    if (error instanceof Error && error.message === 'JOIN_USER_NOT_FOUND') {
      return NextResponse.json({ error: 'Join user not found' }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'JOIN_USER_INSUFFICIENT_BALANCE') {
      return NextResponse.json(
        { error: 'Player has insufficient balance for this entry fee' },
        { status: 400 }
      );
    }
    if (error instanceof Error && error.message === 'ALREADY_JOINED') {
      return NextResponse.json({ error: 'Player already joined this match' }, { status: 400 });
    }
    console.error('Custom match request review error:', error);
    return NextResponse.json({ error: 'Failed to review request' }, { status: 500 });
  }
}
