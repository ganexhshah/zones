import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { requireAuthUser } from '@/lib/route-auth';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => ({}));
    const gameName = String(body.gameName || '').trim();
    const gameId = String(body.gameId || '').trim();
    const inGameName = String(body.inGameName || '').trim();

    if (!gameName || !inGameName) {
      return NextResponse.json(
        { error: 'gameName and inGameName are required' },
        { status: 400 },
      );
    }
    if (!/^\d{7,10}$/.test(gameId)) {
      return NextResponse.json(
        { error: 'Game UID must be 7 to 10 digits' },
        { status: 400 },
      );
    }

    await prisma.gameId.upsert({
      where: {
        userId_gameName: {
          userId: auth.user.id,
          gameName,
        },
      },
      update: {
        gameId,
        inGameName,
      },
      create: {
        userId: auth.user.id,
        gameName,
        gameId,
        inGameName,
      },
    });

    const user = await prisma.user.findUnique({
      where: { id: auth.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (user.email) {
      const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Profile Setup Complete</h2>
          <p>Hello ${user.name || 'Player'},</p>
          <p>Your profile setup is now complete. Welcome to Crackzone.</p>
          <p><strong>Game:</strong> ${gameName}</p>
          <p><strong>UID:</strong> ${gameId}</p>
          <p><strong>In-game Name:</strong> ${inGameName}</p>
          ${user.avatar ? `<p><strong>Avatar:</strong> <a href="${user.avatar}">View image</a></p>` : ''}
          <p>Enjoy and play game!</p>
        </div>
      `;
      await sendEmail(user.email, 'Profile Setup Complete - Crackzone', html);
    }

    return NextResponse.json({
      success: true,
      profile: {
        gameName,
        gameId,
        inGameName,
      },
    });
  } catch (error) {
    console.error('Profile setup completion error:', error);
    return NextResponse.json(
      { error: 'Failed to complete profile setup' },
      { status: 500 },
    );
  }
}
