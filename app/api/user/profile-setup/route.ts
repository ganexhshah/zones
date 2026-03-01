import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { sendEmail } from '@/lib/email';

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

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Profile setup completion error:', error);
    return NextResponse.json(
      { error: 'Failed to complete profile setup' },
      { status: 500 },
    );
  }
}
