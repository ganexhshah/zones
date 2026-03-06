import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const gameIds = await prisma.gameId.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ gameIds });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch game IDs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { gameName, gameId, inGameName } = await req.json();

    const normalizedGameName = String(gameName || '').trim();
    const normalizedGameId = String(gameId || '').trim();
    if (!normalizedGameName) {
      return NextResponse.json({ error: 'Game name is required' }, { status: 400 });
    }
    if (!/^\d{7,10}$/.test(normalizedGameId)) {
      return NextResponse.json({ error: 'Game UID must be 7 to 10 digits' }, { status: 400 });
    }
    const normalizedInGameName = String(inGameName || '').trim();

    const newGameId = await prisma.gameId.upsert({
      where: {
        userId_gameName: {
          userId: auth.user.id,
          gameName: normalizedGameName,
        },
      },
      update: {
        gameId: normalizedGameId,
        inGameName: normalizedInGameName || null,
      },
      create: {
        userId: auth.user.id,
        gameName: normalizedGameName,
        gameId: normalizedGameId,
        inGameName: normalizedInGameName || null,
      },
    });

    return NextResponse.json({ gameId: newGameId });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save game ID' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Game ID required' }, { status: 400 });
    }

    await prisma.gameId.delete({
      where: { id, userId: auth.user.id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete game ID' }, { status: 500 });
  }
}
