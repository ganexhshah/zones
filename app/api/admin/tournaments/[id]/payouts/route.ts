import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthPayload } from '@/lib/route-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuthPayload(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const payouts = await prisma.tournamentPayout.findMany({
      where: { tournamentId: params.id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        registration: {
          include: {
            team: { select: { id: true, name: true } },
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    return NextResponse.json({ payouts });
  } catch (error) {
    console.error('Admin list payouts error:', error);
    return NextResponse.json({ error: 'Failed to fetch payouts' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuthPayload(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'create_manual').toLowerCase();

    if (action === 'create_manual') {
      const registrationId = body.registrationId ? String(body.registrationId) : null;
      const userId = body.userId ? String(body.userId) : null;
      const amount = Number(body.amount ?? 0);
      const rank = body.rank == null || body.rank === '' ? null : Number(body.rank);
      const reason = body.reason ? String(body.reason).trim() : null;
      const currency = body.currency ? String(body.currency).toUpperCase() : 'NPR';
      const method = body.method ? String(body.method) : 'wallet';

      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
      }

      let payoutUserId = userId;
      let finalRegistrationId = registrationId;
      if (registrationId) {
        const reg = await prisma.tournamentRegistration.findFirst({
          where: { id: registrationId, tournamentId: params.id },
          include: { team: true },
        });
        if (!reg) return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
        finalRegistrationId = reg.id;
        payoutUserId = reg.userId || reg.team?.captainId || null;
      }
      if (!payoutUserId) {
        return NextResponse.json({ error: 'Target user not found for payout' }, { status: 400 });
      }

      const payout = await prisma.tournamentPayout.create({
        data: {
          tournamentId: params.id,
          registrationId: finalRegistrationId,
          userId: payoutUserId,
          amount,
          rank,
          currency,
          reason,
          method,
          initiatedByUserId: auth.payload.userId,
          status: 'PENDING',
        },
      });

      return NextResponse.json({ payout }, { status: 201 });
    }

    if (action === 'seed_from_leaderboard') {
      const topN = Number(body.topN ?? 3);
      const distribution = body.distribution && typeof body.distribution === 'object' ? body.distribution : {};
      if (!Number.isInteger(topN) || topN <= 0) {
        return NextResponse.json({ error: 'Invalid topN' }, { status: 400 });
      }

      const leaderboard = await prisma.tournamentLeaderboardEntry.findMany({
        where: { tournamentId: params.id },
        include: { registration: { include: { team: true } } },
        orderBy: { rank: 'asc' },
        take: topN,
      });

      const created: any[] = [];
      for (const row of leaderboard) {
        const amount = Number(distribution[String(row.rank)] ?? 0);
        if (!amount || amount <= 0) continue;
        const userId = row.registration.userId || row.registration.team?.captainId;
        if (!userId) continue;

        const payout = await prisma.tournamentPayout.create({
          data: {
            tournamentId: params.id,
            registrationId: row.registrationId,
            userId,
            amount,
            rank: row.rank,
            reason: `Leaderboard rank #${row.rank}`,
            currency: 'NPR',
            method: 'wallet',
            status: 'PENDING',
            initiatedByUserId: auth.payload.userId,
          },
        });
        created.push(payout);
      }
      return NextResponse.json({ createdCount: created.length, payouts: created });
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (error) {
    console.error('Admin create payouts error:', error);
    return NextResponse.json({ error: 'Failed to create payouts' }, { status: 500 });
  }
}
