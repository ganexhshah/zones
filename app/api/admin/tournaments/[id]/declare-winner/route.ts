import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthPayload } from '@/lib/route-auth';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuthPayload(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => ({}));
    let registrationId = String(body.registrationId || '').trim();
    const winnerUserId = String(body.winnerUserId || '').trim();
    const matchId = body.matchId ? String(body.matchId) : null;

    if (!registrationId && !winnerUserId) {
      return NextResponse.json(
        { error: 'registrationId or winnerUserId is required' },
        { status: 400 }
      );
    }

    let registration = null as null | { id: string; tournamentId: string };
    if (registrationId) {
      registration = await prisma.tournamentRegistration.findFirst({
        where: { id: registrationId, tournamentId: params.id },
        select: { id: true, tournamentId: true },
      });
    } else {
      const participant = await prisma.tournamentParticipant.findFirst({
        where: {
          tournamentId: params.id,
          userId: winnerUserId,
        },
        select: { id: true },
      });
      if (!participant) {
        return NextResponse.json(
          { error: 'Winner user has not joined this tournament' },
          { status: 400 }
        );
      }

      const existingRegistration = await prisma.tournamentRegistration.findFirst({
        where: {
          tournamentId: params.id,
          userId: winnerUserId,
        },
        select: { id: true, tournamentId: true },
      });

      if (existingRegistration) {
        registration = existingRegistration;
      } else {
        const createdRegistration = await prisma.tournamentRegistration.create({
          data: {
            tournamentId: params.id,
            userId: winnerUserId,
            paid: true,
            status: 'APPROVED',
            checkinStatus: 'CHECKED_IN',
            approvedAt: new Date(),
            checkedInAt: new Date(),
          },
          select: { id: true, tournamentId: true },
        });
        registration = createdRegistration;
      }
      registrationId = registration.id;
    }

    if (!registration) {
      return NextResponse.json(
        { error: 'Registration not found for this tournament' },
        { status: 404 }
      );
    }

    const match =
      matchId
        ? await prisma.tournamentMatch.findFirst({
            where: { id: matchId, tournamentId: params.id },
          })
        : await prisma.tournamentMatch.findFirst({
            where: { tournamentId: params.id },
            orderBy: [
              { roundNo: 'desc' },
              { matchIndex: 'desc' },
              { updatedAt: 'desc' },
            ],
          });

    if (!match) {
      return NextResponse.json(
        { error: 'No match found. Start the tournament first.' },
        { status: 400 }
      );
    }

    const existingWinnerParticipant = await prisma.tournamentMatchParticipant.findFirst({
      where: { matchId: match.id, registrationId: registration.id },
      select: { id: true },
    });

    if (!existingWinnerParticipant) {
      await prisma.tournamentMatchParticipant.create({
        data: {
          matchId: match.id,
          registrationId: registration.id,
          joined: true,
        },
      });
    }

    await prisma.tournamentMatchParticipant.updateMany({
      where: { matchId: match.id },
      data: { isWinner: false },
    });

    const winnerParticipant = await prisma.tournamentMatchParticipant.update({
      where: {
        matchId_registrationId: {
          matchId: match.id,
          registrationId: registration.id,
        },
      },
      data: {
        isWinner: true,
        joined: true,
      },
    });

    const updatedMatch = await prisma.tournamentMatch.update({
      where: { id: match.id },
      data: { status: 'FINISHED' },
    });

    const updatedTournament = await prisma.tournament.update({
      where: { id: params.id },
      data: { status: 'completed' },
    });

    return NextResponse.json({
      success: true,
      tournament: updatedTournament,
      match: updatedMatch,
      winnerParticipant,
    });
  } catch (error) {
    console.error('Admin declare winner error:', error);
    return NextResponse.json(
      { error: 'Failed to declare winner' },
      { status: 500 }
    );
  }
}
