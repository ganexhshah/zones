import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

function isAuthorized(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  return Boolean(verifyToken(token));
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const title = String(body.title || '').trim();
    const game = String(body.game || 'Free Fire').trim();
    const mode = String(body.mode || 'SOLO').trim().toUpperCase();
    const format = String(body.format || 'BR_LEAGUE').trim().toUpperCase();
    const regionValue = String(body.region || '').trim();
    const entryFee = Number(body.entryFee ?? 0);
    const prizePool = Number(body.prizePool ?? 0);
    const currency = String(body.currency || 'NPR').trim().toUpperCase();
    const maxPlayers = Number(body.maxPlayers ?? 0);
    const roomSizeRaw = body.roomSize;
    const roomSize = roomSizeRaw === '' || roomSizeRaw == null ? null : Number(roomSizeRaw);
    const startTime = body.startTime ? new Date(body.startTime) : null;
    const registrationOpenAt = body.registrationOpenAt ? new Date(body.registrationOpenAt) : null;
    const registrationCloseAt = body.registrationCloseAt ? new Date(body.registrationCloseAt) : null;
    const checkinOpenAt = body.checkinOpenAt ? new Date(body.checkinOpenAt) : null;
    const checkinCloseAt = body.checkinCloseAt ? new Date(body.checkinCloseAt) : null;
    const rulesTextValue = String(body.rulesText || '').trim();
    let scoringConfigValue: any = null;
    if (typeof body.scoringConfig === 'string') {
      const trimmed = body.scoringConfig.trim();
      scoringConfigValue = trimmed ? JSON.parse(trimmed) : null;
    } else if (body.scoringConfig && typeof body.scoringConfig === 'object') {
      scoringConfigValue = body.scoringConfig;
    }
    const proofRequired = body.proofRequired === undefined ? true : Boolean(body.proofRequired);
    const disputeWindowMinutes = Number(body.disputeWindowMinutes ?? 15);
    const refundRulesValue = String(body.refundRules || '').trim();
    const status = String(body.status || 'upcoming').trim().toLowerCase();
    const imageUrlValue = String(body.imageUrl || '').trim();

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }
    if (!game) {
      return NextResponse.json({ error: 'Game is required' }, { status: 400 });
    }
    if (!Number.isFinite(entryFee) || entryFee < 0) {
      return NextResponse.json({ error: 'Invalid entry fee' }, { status: 400 });
    }
    if (!Number.isFinite(prizePool) || prizePool < 0) {
      return NextResponse.json({ error: 'Invalid prize pool' }, { status: 400 });
    }
    if (!Number.isInteger(maxPlayers) || maxPlayers <= 0) {
      return NextResponse.json({ error: 'Max players must be a positive integer' }, { status: 400 });
    }
    if (roomSize !== null && (!Number.isInteger(roomSize) || roomSize <= 0)) {
      return NextResponse.json({ error: 'Room size must be a positive integer' }, { status: 400 });
    }
    if (!startTime || Number.isNaN(startTime.getTime())) {
      return NextResponse.json({ error: 'Invalid start time' }, { status: 400 });
    }
    if (registrationOpenAt && Number.isNaN(registrationOpenAt.getTime())) {
      return NextResponse.json({ error: 'Invalid registration open time' }, { status: 400 });
    }
    if (registrationCloseAt && Number.isNaN(registrationCloseAt.getTime())) {
      return NextResponse.json({ error: 'Invalid registration close time' }, { status: 400 });
    }
    if (checkinOpenAt && Number.isNaN(checkinOpenAt.getTime())) {
      return NextResponse.json({ error: 'Invalid check-in open time' }, { status: 400 });
    }
    if (checkinCloseAt && Number.isNaN(checkinCloseAt.getTime())) {
      return NextResponse.json({ error: 'Invalid check-in close time' }, { status: 400 });
    }
    if (!Number.isInteger(disputeWindowMinutes) || disputeWindowMinutes < 0) {
      return NextResponse.json({ error: 'Invalid dispute window minutes' }, { status: 400 });
    }

    const tournament = await prisma.tournament.update({
      where: { id: params.id },
      data: {
        title,
        game,
        mode,
        format,
        region: regionValue || null,
        entryFee,
        prizePool,
        currency,
        maxPlayers,
        roomSize,
        startTime,
        registrationOpenAt,
        registrationCloseAt,
        checkinOpenAt,
        checkinCloseAt,
        rulesText: rulesTextValue || null,
        scoringConfig: scoringConfigValue,
        proofRequired,
        disputeWindowMinutes,
        refundRules: refundRulesValue || null,
        status,
        imageUrl: imageUrlValue || null,
      },
    });

    return NextResponse.json({ tournament });
  } catch (error: any) {
    console.error('Update tournament error:', error);
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid scoring JSON' }, { status: 400 });
    }
    if (error?.code === 'P2025') {
      return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to update tournament' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const participantCount = await prisma.tournamentParticipant.count({
      where: { tournamentId: params.id },
    });

    if (participantCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete tournament with participants. Mark it cancelled instead.' },
        { status: 400 }
      );
    }

    await prisma.tournament.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete tournament error:', error);
    if (error?.code === 'P2025') {
      return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to delete tournament' }, { status: 500 });
  }
}
