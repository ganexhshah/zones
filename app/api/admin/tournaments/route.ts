import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get('limit') || '10', 10)),
    );
    const search = (searchParams.get('search') || '').trim();
    const skip = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' as const } },
            { game: { contains: search, mode: 'insensitive' as const } },
            { status: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [tournaments, total] = await Promise.all([
      prisma.tournament.findMany({
        where,
        skip,
        take: limit,
        orderBy: { startTime: 'desc' },
        include: {
          _count: {
            select: { participants: true },
          },
        },
      }),
      prisma.tournament.count({ where }),
    ]);

    return NextResponse.json({
      tournaments: tournaments.map((t) => ({
        ...t,
        currentPlayers: t._count.participants,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get admin tournaments error:', error);
    return NextResponse.json({ error: 'Failed to fetch tournaments' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const body = await req.json().catch(() => ({}));

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

    const tournament = await prisma.tournament.create({
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

    return NextResponse.json({ tournament }, { status: 201 });
  } catch (error: any) {
    console.error('Create tournament error:', error);
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid scoring JSON' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to create tournament' }, { status: 500 });
  }
}

