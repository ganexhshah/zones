import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

const MODE_MAX_PLAYERS: Record<string, number> = {
  '1V1': 2,
  '2V2': 4,
  '3V3': 6,
  '4V4': 8,
};

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { searchParams } = new URL(req.url);
    const mine = searchParams.get('mine') === '1';

    const rows = await prisma.customMatch.findMany({
      where: mine
        ? {
            OR: [
              { createdByUserId: auth.user.id },
              { participants: { some: { userId: auth.user.id } } },
            ],
          }
        : {
            OR: [
              { status: { in: ['OPEN', 'ACTIVE', 'FULL'] } },
              { participants: { some: { userId: auth.user.id } } },
            ],
          },
      include: {
        createdBy: { select: { id: true, name: true } },
        participants: { select: { id: true, userId: true } },
        joinRequests: {
          where: { userId: auth.user.id },
          select: { id: true, status: true },
        },
        resultSubmissions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            winnerUserId: true,
            status: true,
            proofUrl: true,
            createdAt: true,
            winner: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const matches = rows.map((match) => {
      const isCreator = match.createdByUserId === auth.user.id;
      const isParticipant = match.participants.some((p) => p.userId === auth.user.id);
      const latestResult = match.resultSubmissions[0] ?? null;

      // Room credentials must only be visible to creator or joined participants.
      const visibleRoomId = isCreator || isParticipant ? match.roomId : null;
      const visibleRoomPassword = isCreator || isParticipant ? match.roomPassword : null;

      return {
        ...match,
        roomId: visibleRoomId,
        roomPassword: visibleRoomPassword,
        resultSubmissions: latestResult ? [latestResult] : [],
      };
    });

    return NextResponse.json({ matches });
  } catch (error) {
    console.error('Custom match list error:', error);
    return NextResponse.json({ error: 'Failed to fetch custom matches' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const roomType = String(body.roomType || 'CUSTOM_ROOM').toUpperCase();
    const mode = String(body.mode || '1V1').toUpperCase();
    const rounds = Number(body.rounds || 13);
    const entryFee = Number(body.entryFee || 0);
    const title = String(body.title || `${roomType === 'LONE_WOLF' ? 'Lone Wolf' : 'Custom Room'} Match`).trim();

    if (!MODE_MAX_PLAYERS[mode]) {
      return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
    }
    if (!['CUSTOM_ROOM', 'LONE_WOLF'].includes(roomType)) {
      return NextResponse.json({ error: 'Invalid roomType' }, { status: 400 });
    }
    if (!Number.isFinite(rounds) || rounds <= 0) {
      return NextResponse.json({ error: 'Invalid rounds' }, { status: 400 });
    }
    if (!Number.isFinite(entryFee) || entryFee < 0) {
      return NextResponse.json({ error: 'Invalid entryFee' }, { status: 400 });
    }

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: auth.user.id },
        select: { id: true, walletBalance: true },
      });
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      if (entryFee > 0) {
        if (user.walletBalance < entryFee) {
          throw new Error('INSUFFICIENT_BALANCE');
        }

        await tx.user.update({
          where: { id: auth.user.id },
          data: { walletBalance: { decrement: entryFee } },
        });

        await tx.transaction.create({
          data: {
            userId: auth.user.id,
            type: 'custom_match_entry_fee',
            amount: entryFee,
            method: 'wallet',
            status: 'completed',
            reference: 'Custom match creation entry fee',
          },
        });
      }

      const match = await tx.customMatch.create({
        data: {
          createdByUserId: auth.user.id,
          title,
          roomType,
          mode,
          rounds,
          entryFee,
          defaultCoin: Number(body.defaultCoin || 9950),
          throwableLimit: Boolean(body.throwableLimit),
          characterSkill: Boolean(body.characterSkill),
          allSkillsAllowed: body.allSkillsAllowed !== false,
          selectedSkills: Array.isArray(body.selectedSkills) ? body.selectedSkills : null,
          headshotOnly: body.headshotOnly !== false,
          gunAttributes: Boolean(body.gunAttributes),
          maxPlayers: MODE_MAX_PLAYERS[mode],
          status: 'OPEN',
        },
      });

      await tx.customMatchParticipant.create({
        data: {
          customMatchId: match.id,
          userId: auth.user.id,
          slotNo: 1,
        },
      });

      return match;
    });

    return NextResponse.json({ match: created }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'INSUFFICIENT_BALANCE') {
      return NextResponse.json(
        { error: 'Insufficient wallet balance. Please add money first.' },
        { status: 400 }
      );
    }
    console.error('Create custom match error:', error);
    return NextResponse.json({ error: 'Failed to create custom match' }, { status: 500 });
  }
}
