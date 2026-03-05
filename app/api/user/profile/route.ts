import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { resolveAccountRestriction } from '@/lib/account-status';

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        avatar: true,
        walletBalance: true,
        coinBalance: true,
        freeEntryTokens: true,
        isVerified: true,
        isBlocked: true,
        blockReason: true,
        suspendedUntil: true,
        createdAt: true,
        gameIds: {
          select: {
            id: true,
            gameName: true,
            gameId: true,
            inGameName: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const restriction = await resolveAccountRestriction({
      id: user.id,
      isBlocked: user.isBlocked,
      blockReason: user.blockReason,
      suspendedUntil: user.suspendedUntil,
    });
    if (restriction) {
      return NextResponse.json(
        {
          error:
            restriction.status === 'SUSPENDED'
              ? 'Account suspended'
              : 'Account blocked',
          accountStatus: restriction,
        },
        { status: 403 },
      );
    }

    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { name, phone } = await req.json();

    const existing = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        isBlocked: true,
        blockReason: true,
        suspendedUntil: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const restriction = await resolveAccountRestriction(existing);
    if (restriction) {
      return NextResponse.json(
        {
          error:
            restriction.status === 'SUSPENDED'
              ? 'Account suspended'
              : 'Account blocked',
          accountStatus: restriction,
        },
        { status: 403 },
      );
    }

    const user = await prisma.user.update({
      where: { id: payload.userId },
      data: { name, phone },
    });

    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
