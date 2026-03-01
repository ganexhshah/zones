import {
  EscrowStatus,
  JoinRequestStatus,
  MatchStatus,
  Prisma,
  WalletLedgerType,
} from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { decryptText, encryptText } from '@/lib/match-v1/crypto';
import { emitMatchAndUsers, emitToMatch, emitToUser } from '@/lib/match-v1/realtime';
import { sendPushToUser } from '@/lib/push';

function toNumber(v: Prisma.Decimal | number | string | null | undefined) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  return Number(v);
}

function now() {
  return new Date();
}

function getEffectiveAvailableBalance(user: {
  availableBalance: Prisma.Decimal | number | string;
  lockedBalance: Prisma.Decimal | number | string;
  walletBalance: Prisma.Decimal | number | string | null;
}) {
  const available = new Prisma.Decimal(user.availableBalance ?? 0);
  const locked = new Prisma.Decimal(user.lockedBalance ?? 0);
  const walletTotal = new Prisma.Decimal(user.walletBalance ?? 0);
  const inferredAvailable = Prisma.Decimal.max(
    new Prisma.Decimal(0),
    walletTotal.minus(locked),
  );
  return Prisma.Decimal.max(available, inferredAvailable);
}

async function lockUserRow(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
}

async function lockMatchRow(tx: Prisma.TransactionClient, matchId: string) {
  await tx.$queryRaw`SELECT id FROM "Match" WHERE id = ${matchId}::uuid FOR UPDATE`;
}

async function appendLedger(params: {
  tx: Prisma.TransactionClient;
  userId: string;
  matchId?: string | null;
  type: WalletLedgerType;
  amount: Prisma.Decimal;
  balanceAfter: Prisma.Decimal;
}) {
  await params.tx.walletLedger.create({
    data: {
      userId: params.userId,
      matchId: params.matchId ?? null,
      type: params.type,
      amount: params.amount,
      balanceAfter: params.balanceAfter,
    },
  });
}

async function applyWalletState(
  tx: Prisma.TransactionClient,
  userId: string,
  availableBalance: Prisma.Decimal,
  lockedBalance: Prisma.Decimal,
) {
  await tx.user.update({
    where: { id: userId },
    data: {
      availableBalance,
      lockedBalance,
      walletBalance: toNumber(availableBalance.plus(lockedBalance)),
    },
  });
}

async function applyAvailableOnlyState(
  tx: Prisma.TransactionClient,
  userId: string,
  availableBalance: Prisma.Decimal,
) {
  await tx.user.update({
    where: { id: userId },
    data: {
      availableBalance,
      walletBalance: toNumber(availableBalance),
    },
  });
}

function ensurePositiveDecimal(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
}

export function maskCredential(value: string) {
  if (value.length < 4) return '*'.repeat(value.length);
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function canViewRoom(userId: string, match: { creatorId: string; joinerId: string | null; status: MatchStatus }) {
  if (match.status !== MatchStatus.CONFIRMED && match.status !== MatchStatus.COMPLETED) return false;
  return userId === match.creatorId || userId === match.joinerId;
}

async function notifyUser(params: {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}) {
  try {
    await sendPushToUser(params.userId, {
      title: params.title,
      body: params.body,
      category: 'CUSTOM',
      data: {
        type: 'custom_match',
        ...params.data,
      },
    });
  } catch (error) {
    console.error('Custom match notify error:', error);
  }
}

export async function createMatch(params: {
  creatorId: string;
  entryFee: number;
  gameName: string;
  roomType: 'CUSTOM_ROOM' | 'LONE_WOLF';
  matchType: '1v1' | '2v2' | '3v3' | '4v4';
  rounds: number;
  defaultCoin: number;
  throwableLimit: boolean;
  characterSkill: boolean;
  allSkillsAllowed: boolean;
  selectedSkills: string[];
  headshotOnly: boolean;
  gunAttributes: boolean;
  platformFeePercent: number;
}) {
  ensurePositiveDecimal(params.entryFee, 'entryFee');

  const entryFee = new Prisma.Decimal(params.entryFee);
  const prizePool = entryFee.mul(2).mul(new Prisma.Decimal(1).minus(new Prisma.Decimal(params.platformFeePercent).div(100)));

  const match = await prisma.$transaction(async (tx) => {
    await lockUserRow(tx, params.creatorId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: params.creatorId } });

    const available = getEffectiveAvailableBalance(user);
    if (available.lt(entryFee)) {
      throw new Error('INSUFFICIENT_BALANCE');
    }

    const nextAvailable = available.minus(entryFee);
    await applyAvailableOnlyState(tx, user.id, nextAvailable);

    const created = await tx.match.create({
      data: {
        creatorId: user.id,
        entryFee,
        prizePool,
        gameName: params.gameName,
        roomType: params.roomType,
        matchType: params.matchType,
        rounds: params.rounds,
        defaultCoin: params.defaultCoin,
        throwableLimit: params.throwableLimit,
        characterSkill: params.characterSkill,
        allSkillsAllowed: params.allSkillsAllowed,
        selectedSkills: params.selectedSkills,
        headshotOnly: params.headshotOnly,
        gunAttributes: params.gunAttributes,
        status: MatchStatus.OPEN,
      },
    });

    await appendLedger({
      tx,
      userId: user.id,
      matchId: created.id,
      type: WalletLedgerType.LOCK,
      amount: entryFee,
      balanceAfter: nextAvailable,
    });

    await tx.matchLog.create({
      data: {
        matchId: created.id,
        action: 'MATCH_CREATED',
        performedBy: user.id,
        meta: {
          entryFee: params.entryFee,
          gameName: params.gameName,
          roomType: params.roomType,
          matchType: params.matchType,
          rounds: params.rounds,
          defaultCoin: params.defaultCoin,
          throwableLimit: params.throwableLimit,
          characterSkill: params.characterSkill,
          allSkillsAllowed: params.allSkillsAllowed,
          selectedSkills: params.selectedSkills,
          headshotOnly: params.headshotOnly,
          gunAttributes: params.gunAttributes,
        },
      },
    });

    return created;
  });

  emitMatchAndUsers({
    matchId: match.id,
    userIds: [match.creatorId],
    event: 'match.created',
    payload: {
      matchId: match.id,
      status: match.status,
      entryFee: toNumber(match.entryFee),
      prizePool: toNumber(match.prizePool),
    },
  });

  await notifyUser({
    userId: match.creatorId,
    title: 'Custom Match Created',
    body: `Entry Rs.${toNumber(match.entryFee)} | Prize Rs.${toNumber(match.prizePool)}`,
    data: {
      event: 'match_created',
      matchId: match.id,
      status: match.status,
    },
  });

  return match;
}

export async function listMatches(params: { status?: MatchStatus; limit: number }) {
  return prisma.match.findMany({
    where: params.status ? { status: params.status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: params.limit,
    include: {
      creator: { select: { id: true, name: true, avatar: true } },
      joiner: { select: { id: true, name: true, avatar: true } },
      joinRequests: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
}

export async function getMatchDetails(matchId: string, requesterId: string) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      creator: { select: { id: true, name: true, avatar: true } },
      joiner: { select: { id: true, name: true, avatar: true } },
      joinRequests: { orderBy: { createdAt: 'desc' } },
      escrows: { orderBy: { createdAt: 'desc' }, take: 1 },
      logs: {
        where: { action: { in: ['RESULT_SUBMITTED', 'MATCH_COMPLETED'] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          performer: { select: { id: true, name: true, avatar: true } },
        },
      },
    },
  });

  if (!match) return null;

  const roomVisible = canViewRoom(requesterId, match);
  let roomId: string | null = null;
  let roomPassword: string | null = null;

  if (roomVisible && match.roomIdEncrypted && match.roomPassEncrypted) {
    roomId = decryptText(match.roomIdEncrypted);
    roomPassword = decryptText(match.roomPassEncrypted);
  }

  const latestSubmissionLog = match.logs.find((log) => log.action === 'RESULT_SUBMITTED');
  const latestCompletionLog = match.logs.find((log) => log.action === 'MATCH_COMPLETED');

  const resultSubmission = latestSubmissionLog
    ? {
        status: 'SUBMITTED_FOR_VERIFICATION',
        submittedAt: latestSubmissionLog.createdAt,
        submittedBy: latestSubmissionLog.performer
          ? {
              id: latestSubmissionLog.performer.id,
              name: latestSubmissionLog.performer.name,
              avatar: latestSubmissionLog.performer.avatar,
            }
          : null,
        winnerUserId:
          latestSubmissionLog.meta &&
          typeof latestSubmissionLog.meta === 'object' &&
          'winnerUserId' in latestSubmissionLog.meta
            ? (latestSubmissionLog.meta as { winnerUserId?: string }).winnerUserId ?? null
            : null,
        note:
          latestSubmissionLog.meta &&
          typeof latestSubmissionLog.meta === 'object' &&
          'note' in latestSubmissionLog.meta
            ? (latestSubmissionLog.meta as { note?: string }).note ?? null
            : null,
        proofUrl:
          latestSubmissionLog.meta &&
          typeof latestSubmissionLog.meta === 'object' &&
          'proofUrl' in latestSubmissionLog.meta
            ? (latestSubmissionLog.meta as { proofUrl?: string }).proofUrl ?? null
            : null,
      }
    : null;

  const completion = latestCompletionLog
    ? {
        verifiedAt: latestCompletionLog.createdAt,
        winnerUserId:
          latestCompletionLog.meta &&
          typeof latestCompletionLog.meta === 'object' &&
          'winnerUserId' in latestCompletionLog.meta
            ? (latestCompletionLog.meta as { winnerUserId?: string }).winnerUserId ?? null
            : null,
      }
    : null;

  return {
    ...match,
    roomId,
    roomPassword,
    roomIdMasked: match.roomIdEncrypted ? maskCredential(roomId ?? '') : null,
    roomPasswordMasked: match.roomPassEncrypted ? maskCredential(roomPassword ?? '') : null,
    resultSubmission,
    completion,
  };
}

export async function joinMatch(params: {
  matchId: string;
  joinerId: string;
  ip?: string | null;
}) {
  const { matchId, joinerId } = params;

  const result = await prisma.$transaction(async (tx) => {
    await lockMatchRow(tx, matchId);
    const match = await tx.match.findUniqueOrThrow({ where: { id: matchId } });

    if (match.status !== MatchStatus.OPEN) throw new Error('MATCH_NOT_OPEN');
    if (match.creatorId === joinerId) throw new Error('SELF_JOIN_NOT_ALLOWED');

    await lockUserRow(tx, joinerId);
    const joiner = await tx.user.findUniqueOrThrow({ where: { id: joinerId } });

    const available = getEffectiveAvailableBalance(joiner);
    const entryFee = new Prisma.Decimal(match.entryFee);

    if (available.lt(entryFee)) throw new Error('INSUFFICIENT_BALANCE');

    const pendingExisting = await tx.joinRequest.findFirst({
      where: { matchId, joinerId, status: JoinRequestStatus.PENDING },
    });
    if (pendingExisting) throw new Error('ALREADY_REQUESTED');

    const nextAvailable = available.minus(entryFee);
    await applyAvailableOnlyState(tx, joinerId, nextAvailable);

    const joinRequest = await tx.joinRequest.upsert({
      where: { matchId_joinerId: { matchId, joinerId } },
      update: { status: JoinRequestStatus.PENDING },
      create: { matchId, joinerId, status: JoinRequestStatus.PENDING },
    });

    const updatedMatch = await tx.match.update({
      where: { id: matchId },
      data: {
        joinerId,
        status: MatchStatus.PENDING_APPROVAL,
        expiresAt: null,
      },
    });

    await appendLedger({
      tx,
      userId: joinerId,
      matchId,
      type: WalletLedgerType.LOCK,
      amount: entryFee,
      balanceAfter: nextAvailable,
    });

    await tx.matchLog.create({
      data: {
        matchId,
        action: 'JOIN_REQUEST_CREATED',
        performedBy: joinerId,
        meta: { joinRequestId: joinRequest.id, expiresAt: null },
      },
    });

    if (params.ip) {
      const repeatedCount = await tx.match.count({
        where: {
          creatorId: match.creatorId,
          joinerId,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      });
      if (repeatedCount >= 3) {
        await tx.fraudFlag.create({
          data: {
            userId: joinerId,
            matchId,
            reason: 'Repeated joins against same creator in 24h window',
            ip: params.ip,
          },
        });
      }
    }

    return { updatedMatch, joinRequest, creatorId: match.creatorId };
  }, {
    maxWait: 15000,
    timeout: 20000,
  });

  emitMatchAndUsers({
    matchId,
    userIds: [result.creatorId, joinerId],
    event: 'match.requested',
    payload: {
      matchId,
      status: MatchStatus.PENDING_APPROVAL,
      joinRequest: {
        id: result.joinRequest.id,
        status: result.joinRequest.status,
      },
      expiresAt: result.updatedMatch.expiresAt,
    },
  });

  await Promise.allSettled([
    notifyUser({
      userId: result.creatorId,
      title: 'Join Request Received',
      body: 'A player requested to join your custom match.',
      data: {
        event: 'join_requested_creator',
        matchId,
        status: MatchStatus.PENDING_APPROVAL,
      },
    }),
    notifyUser({
      userId: joinerId,
      title: 'Join Request Sent',
      body: 'Your request is pending creator approval.',
      data: {
        event: 'join_requested_joiner',
        matchId,
        status: MatchStatus.PENDING_APPROVAL,
      },
    }),
  ]);

  return result;
}

export async function acceptJoinRequest(params: { matchId: string; creatorId: string }) {
  const { matchId, creatorId } = params;

  const result = await prisma.$transaction(async (tx) => {
    await lockMatchRow(tx, matchId);
    const match = await tx.match.findUniqueOrThrow({ where: { id: matchId } });

    if (match.creatorId !== creatorId) throw new Error('FORBIDDEN');
    if (match.status !== MatchStatus.PENDING_APPROVAL) throw new Error('INVALID_STATUS');
    if (!match.joinerId) throw new Error('NO_JOINER');

    const joinRequest = await tx.joinRequest.findFirst({
      where: { matchId, joinerId: match.joinerId, status: JoinRequestStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
    if (!joinRequest) throw new Error('NO_PENDING_REQUEST');

    await tx.joinRequest.update({
      where: { id: joinRequest.id },
      data: { status: JoinRequestStatus.ACCEPTED },
    });

    const updated = await tx.match.update({
      where: { id: matchId },
      data: { status: MatchStatus.CONFIRMED, expiresAt: null },
    });

    const existingEscrow = await tx.escrow.findFirst({ where: { matchId, status: EscrowStatus.LOCKED } });
    const total = new Prisma.Decimal(match.entryFee).mul(2);

    if (!existingEscrow) {
      await tx.escrow.create({
        data: { matchId, totalAmount: total, status: EscrowStatus.LOCKED },
      });
    }

    await tx.matchLog.create({
      data: {
        matchId,
        action: 'JOIN_REQUEST_ACCEPTED',
        performedBy: creatorId,
        meta: { joinRequestId: joinRequest.id },
      },
    });

    return { updated, joinerId: match.joinerId };
  });

  emitMatchAndUsers({
    matchId,
    userIds: [creatorId, result.joinerId],
    event: 'match.accepted',
    payload: {
      matchId,
      status: MatchStatus.CONFIRMED,
    },
  });

  await Promise.allSettled([
    notifyUser({
      userId: creatorId,
      title: 'Join Request Accepted',
      body: 'Match is confirmed. Submit room details to continue.',
      data: {
        event: 'join_accepted_creator',
        matchId,
        status: MatchStatus.CONFIRMED,
      },
    }),
    notifyUser({
      userId: result.joinerId,
      title: 'Request Accepted',
      body: 'Your join request was accepted. Match confirmed.',
      data: {
        event: 'join_accepted_joiner',
        matchId,
        status: MatchStatus.CONFIRMED,
      },
    }),
  ]);

  return result;
}

export async function rejectJoinRequest(params: { matchId: string; creatorId: string }) {
  const { matchId, creatorId } = params;

  const result = await prisma.$transaction(async (tx) => {
    await lockMatchRow(tx, matchId);
    const match = await tx.match.findUniqueOrThrow({ where: { id: matchId } });
    if (match.creatorId !== creatorId) throw new Error('FORBIDDEN');
    if (!match.joinerId) throw new Error('NO_JOINER');

    const joinerId = match.joinerId;
    await lockUserRow(tx, joinerId);
    const joiner = await tx.user.findUniqueOrThrow({ where: { id: joinerId } });

    const entryFee = new Prisma.Decimal(match.entryFee);
    const nextAvailable = new Prisma.Decimal(joiner.availableBalance).plus(entryFee);
    await applyAvailableOnlyState(tx, joinerId, nextAvailable);

    const request = await tx.joinRequest.findFirst({
      where: { matchId, joinerId, status: JoinRequestStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });

    if (request) {
      await tx.joinRequest.update({ where: { id: request.id }, data: { status: JoinRequestStatus.REJECTED } });
    }

    await tx.match.update({
      where: { id: matchId },
      data: {
        joinerId: null,
        status: MatchStatus.OPEN,
        expiresAt: null,
      },
    });

    await appendLedger({
      tx,
      userId: joinerId,
      matchId,
      type: WalletLedgerType.REFUND,
      amount: entryFee,
      balanceAfter: nextAvailable,
    });

    await tx.matchLog.create({
      data: {
        matchId,
        action: 'JOIN_REQUEST_REJECTED',
        performedBy: creatorId,
        meta: { joinerId },
      },
    });

    return { joinerId };
  });

  emitMatchAndUsers({
    matchId,
    userIds: [creatorId, result.joinerId],
    event: 'match.rejected',
    payload: {
      matchId,
      status: MatchStatus.OPEN,
      refundedUserId: result.joinerId,
    },
  });

  emitToUser(result.joinerId, 'wallet.updated', { reason: 'JOIN_REQUEST_REJECTED', matchId });

  await Promise.allSettled([
    notifyUser({
      userId: creatorId,
      title: 'Join Request Rejected',
      body: 'Join request rejected. Match is open again.',
      data: {
        event: 'join_rejected_creator',
        matchId,
        status: MatchStatus.OPEN,
      },
    }),
    notifyUser({
      userId: result.joinerId,
      title: 'Request Rejected',
      body: 'Your join request was rejected. Amount refunded to wallet.',
      data: {
        event: 'join_rejected_joiner',
        matchId,
        status: MatchStatus.OPEN,
      },
    }),
  ]);

  return result;
}

export async function cancelMatch(params: { matchId: string; creatorId: string }) {
  const { matchId, creatorId } = params;
  const result = await prisma.$transaction(async (tx) => {
    await lockMatchRow(tx, matchId);
    const match = await tx.match.findUniqueOrThrow({ where: { id: matchId } });

    if (match.creatorId !== creatorId) throw new Error('FORBIDDEN');
    if (match.status !== MatchStatus.OPEN) throw new Error('INVALID_STATUS');

    await lockUserRow(tx, creatorId);
    const creator = await tx.user.findUniqueOrThrow({ where: { id: creatorId } });
    const entryFee = new Prisma.Decimal(match.entryFee);

    const nextAvailable = new Prisma.Decimal(creator.availableBalance).plus(entryFee);
    await applyAvailableOnlyState(tx, creatorId, nextAvailable);

    await tx.match.update({
      where: { id: matchId },
      data: { status: MatchStatus.CANCELLED, expiresAt: null },
    });

    await appendLedger({
      tx,
      userId: creatorId,
      matchId,
      type: WalletLedgerType.REFUND,
      amount: entryFee,
      balanceAfter: nextAvailable,
    });

    await tx.matchLog.create({
      data: {
        matchId,
        action: 'MATCH_CANCELLED',
        performedBy: creatorId,
      },
    });

    return { creatorId };
  });

  emitMatchAndUsers({
    matchId,
    userIds: [result.creatorId],
    event: 'match.rejected',
    payload: { matchId, status: MatchStatus.CANCELLED },
  });
  emitToUser(result.creatorId, 'wallet.updated', { reason: 'MATCH_CANCELLED', matchId });

  await notifyUser({
    userId: result.creatorId,
    title: 'Match Cancelled',
    body: 'Your custom match was cancelled and entry amount refunded.',
    data: {
      event: 'match_cancelled',
      matchId,
      status: MatchStatus.CANCELLED,
    },
  });
}

export async function expirePendingMatches(nowDate = new Date()) {
  void nowDate;
  // Join requests no longer expire automatically.
  return 0;

  /*
  const pendingMatches = await prisma.match.findMany({
    where: {
      status: MatchStatus.PENDING_APPROVAL,
      expiresAt: { lt: nowDate },
      joinerId: { not: null },
    },
    select: { id: true },
    take: 100,
  });

  for (const row of pendingMatches) {
    await prisma.$transaction(async (tx) => {
      await lockMatchRow(tx, row.id);
      const match = await tx.match.findUnique({ where: { id: row.id } });
      if (!match || !match.joinerId || match.status !== MatchStatus.PENDING_APPROVAL) return;

      await lockUserRow(tx, match.joinerId);
      const joiner = await tx.user.findUniqueOrThrow({ where: { id: match.joinerId } });
      const entryFee = new Prisma.Decimal(match.entryFee);
      const nextAvailable = new Prisma.Decimal(joiner.availableBalance).plus(entryFee);
      await applyAvailableOnlyState(tx, joiner.id, nextAvailable);

      await tx.joinRequest.updateMany({
        where: { matchId: match.id, joinerId: joiner.id, status: JoinRequestStatus.PENDING },
        data: { status: JoinRequestStatus.EXPIRED },
      });

      await tx.match.update({
        where: { id: match.id },
        data: { status: MatchStatus.OPEN, joinerId: null, expiresAt: null },
      });

      await appendLedger({
        tx,
        userId: joiner.id,
        matchId: match.id,
        type: WalletLedgerType.REFUND,
        amount: entryFee,
        balanceAfter: nextAvailable,
      });

      await tx.matchLog.create({
        data: {
          matchId: match.id,
          action: 'JOIN_REQUEST_EXPIRED',
          meta: { joinerId: joiner.id },
        },
      });

      emitMatchAndUsers({
        matchId: match.id,
        userIds: [match.creatorId, joiner.id],
        event: 'match.expired',
        payload: {
          matchId: match.id,
          status: MatchStatus.OPEN,
          joinerId: joiner.id,
        },
      });
      emitToUser(joiner.id, 'wallet.updated', { reason: 'JOIN_REQUEST_EXPIRED', matchId: match.id });
    });
  }

  return pendingMatches.length;
  */
}

export async function submitRoom(params: {
  matchId: string;
  creatorId: string;
  roomId: string;
  roomPassword: string;
}) {
  const result = await prisma.$transaction(async (tx) => {
    await lockMatchRow(tx, params.matchId);
    const match = await tx.match.findUniqueOrThrow({ where: { id: params.matchId } });

    if (match.creatorId !== params.creatorId) throw new Error('FORBIDDEN');
    if (match.status !== MatchStatus.CONFIRMED) throw new Error('INVALID_STATUS');

    const updated = await tx.match.update({
      where: { id: params.matchId },
      data: {
        roomIdEncrypted: encryptText(params.roomId),
        roomPassEncrypted: encryptText(params.roomPassword),
      },
    });

    await tx.matchLog.create({
      data: {
        matchId: params.matchId,
        action: 'ROOM_SUBMITTED',
        performedBy: params.creatorId,
      },
    });

    return updated;
  });

  if (result.joinerId) {
    emitMatchAndUsers({
      matchId: params.matchId,
      userIds: [params.creatorId, result.joinerId],
      event: 'match.room_ready',
      payload: {
        matchId: params.matchId,
        status: MatchStatus.CONFIRMED,
        roomIdMasked: maskCredential(params.roomId),
        roomPasswordMasked: maskCredential(params.roomPassword),
      },
    });

    await Promise.allSettled([
      notifyUser({
        userId: params.creatorId,
        title: 'Room Details Submitted',
        body: 'Room credentials are shared with the joiner.',
        data: {
          event: 'room_ready_creator',
          matchId: params.matchId,
          status: MatchStatus.CONFIRMED,
        },
      }),
      notifyUser({
        userId: result.joinerId,
        title: 'Room Details Ready',
        body: 'Room ID and password are now available.',
        data: {
          event: 'room_ready_joiner',
          matchId: params.matchId,
          status: MatchStatus.CONFIRMED,
        },
      }),
    ]);
  }

  return result;
}

export async function submitResult(params: {
  matchId: string;
  submittedBy: string;
  winnerUserId: string;
  note?: string;
  proofUrl?: string;
}) {
  const result = await prisma.$transaction(async (tx) => {
    await lockMatchRow(tx, params.matchId);
    const match = await tx.match.findUniqueOrThrow({ where: { id: params.matchId } });
    if (match.status !== MatchStatus.CONFIRMED) throw new Error('INVALID_STATUS');

    if (params.submittedBy !== match.creatorId && params.submittedBy !== match.joinerId) {
      throw new Error('FORBIDDEN');
    }

    await tx.matchLog.create({
      data: {
        matchId: params.matchId,
        action: 'RESULT_SUBMITTED',
        performedBy: params.submittedBy,
        meta: {
          winnerUserId: params.winnerUserId,
          note: params.note ?? null,
          proofUrl: params.proofUrl ?? null,
          status: 'SUBMITTED_FOR_VERIFICATION',
        },
      },
    });

    return {
      submitted: true,
      creatorId: match.creatorId,
      joinerId: match.joinerId,
    };
  });

  if (result.joinerId) {
    const notifyTargets = [result.creatorId, result.joinerId];
    await Promise.allSettled(
      notifyTargets.map((userId) =>
        notifyUser({
          userId,
          title: 'Result Submitted',
          body: 'Result submitted. Waiting for admin verification.',
          data: {
            event: 'result_submitted',
            matchId: params.matchId,
            status: MatchStatus.CONFIRMED,
          },
        })
      )
    );
  }

  return { submitted: true };
}

export async function verifyMatchAndPayout(params: {
  matchId: string;
  verifiedBy: string;
  winnerUserId: string;
  platformFeePercent: number;
}) {
  const result = await prisma.$transaction(async (tx) => {
    await lockMatchRow(tx, params.matchId);

    const match = await tx.match.findUniqueOrThrow({ where: { id: params.matchId } });
    if (match.status !== MatchStatus.CONFIRMED) throw new Error('INVALID_STATUS');
    if (!match.joinerId) throw new Error('NO_JOINER');

    if (![match.creatorId, match.joinerId].includes(params.winnerUserId)) {
      throw new Error('INVALID_WINNER');
    }

    const escrow = await tx.escrow.findFirst({ where: { matchId: params.matchId, status: EscrowStatus.LOCKED } });
    if (!escrow) throw new Error('ESCROW_NOT_FOUND');

    const total = new Prisma.Decimal(match.entryFee).mul(2);
    const fee = total.mul(new Prisma.Decimal(params.platformFeePercent).div(100));
    const winnerCredit = total.minus(fee);

    await lockUserRow(tx, match.creatorId);
    await lockUserRow(tx, match.joinerId);
    await lockUserRow(tx, params.winnerUserId);

    const creator = await tx.user.findUniqueOrThrow({ where: { id: match.creatorId } });
    const joiner = await tx.user.findUniqueOrThrow({ where: { id: match.joinerId } });
    const winner = await tx.user.findUniqueOrThrow({ where: { id: params.winnerUserId } });

    const entryFee = new Prisma.Decimal(match.entryFee);

    const winnerNextAvailable = new Prisma.Decimal(winner.availableBalance).plus(winnerCredit);
    await applyAvailableOnlyState(tx, winner.id, winnerNextAvailable);

    await appendLedger({
      tx,
      userId: winner.id,
      matchId: match.id,
      type: WalletLedgerType.WIN,
      amount: winnerCredit,
      balanceAfter: winnerNextAvailable,
    });

    await appendLedger({
      tx,
      userId: winner.id,
      matchId: match.id,
      type: WalletLedgerType.FEE,
      amount: fee,
      balanceAfter: winnerNextAvailable,
    });

    await tx.escrow.updateMany({
      where: { matchId: match.id, status: EscrowStatus.LOCKED },
      data: { status: EscrowStatus.RELEASED },
    });

    await tx.match.update({
      where: { id: match.id },
      data: { status: MatchStatus.COMPLETED, completedAt: now() },
    });

    await tx.matchLog.create({
      data: {
        matchId: match.id,
        action: 'MATCH_COMPLETED',
        performedBy: params.verifiedBy,
        meta: {
          winnerUserId: params.winnerUserId,
          total: toNumber(total),
          fee: toNumber(fee),
          winnerCredit: toNumber(winnerCredit),
        },
      },
    });

    return {
      match,
      winnerUserId: params.winnerUserId,
      creatorId: match.creatorId,
      joinerId: match.joinerId,
      fee,
      winnerCredit,
    };
  });

  emitMatchAndUsers({
    matchId: params.matchId,
    userIds: [result.creatorId, result.joinerId],
    event: 'match.completed',
    payload: {
      matchId: params.matchId,
      status: MatchStatus.COMPLETED,
      winnerUserId: result.winnerUserId,
      winnerCredit: toNumber(result.winnerCredit),
      fee: toNumber(result.fee),
    },
  });

  emitToUser(result.creatorId, 'wallet.updated', { matchId: params.matchId, reason: 'MATCH_COMPLETED' });
  emitToUser(result.joinerId, 'wallet.updated', { matchId: params.matchId, reason: 'MATCH_COMPLETED' });

  await Promise.allSettled([
    notifyUser({
      userId: result.creatorId,
      title: 'Match Completed',
      body:
        result.winnerUserId === result.creatorId
          ? `You won Rs.${toNumber(result.winnerCredit)}.`
          : 'Match completed. Better luck next round.',
      data: {
        event: 'match_completed_creator',
        matchId: params.matchId,
        status: MatchStatus.COMPLETED,
        winnerUserId: result.winnerUserId,
      },
    }),
    notifyUser({
      userId: result.joinerId,
      title: 'Match Completed',
      body:
        result.winnerUserId === result.joinerId
          ? `You won Rs.${toNumber(result.winnerCredit)}.`
          : 'Match completed. Better luck next round.',
      data: {
        event: 'match_completed_joiner',
        matchId: params.matchId,
        status: MatchStatus.COMPLETED,
        winnerUserId: result.winnerUserId,
      },
    }),
  ]);
}

export async function getMatchLedger(matchId: string, requesterId: string) {
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) throw new Error('NOT_FOUND');
  if (![match.creatorId, match.joinerId].includes(requesterId)) throw new Error('FORBIDDEN');

  return prisma.walletLedger.findMany({
    where: { matchId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listChatMessages(params: { matchId: string; requesterId: string; cursor?: string; limit?: number }) {
  const match = await prisma.match.findUnique({ where: { id: params.matchId } });
  if (!match) throw new Error('NOT_FOUND');
  if (![match.creatorId, match.joinerId].includes(params.requesterId)) throw new Error('FORBIDDEN');

  const take = Math.min(params.limit ?? 30, 100);
  return prisma.chatMessage.findMany({
    where: { matchId: params.matchId },
    orderBy: { createdAt: 'desc' },
    take,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

export async function sendChatMessage(params: { matchId: string; senderId: string; message: string }) {
  const row = await prisma.$transaction(async (tx) => {
    await lockMatchRow(tx, params.matchId);
    const match = await tx.match.findUniqueOrThrow({ where: { id: params.matchId } });

    if (![match.creatorId, match.joinerId].includes(params.senderId)) throw new Error('FORBIDDEN');
    if (match.status !== MatchStatus.CONFIRMED) throw new Error('CHAT_DISABLED');

    return tx.chatMessage.create({
      data: {
        matchId: params.matchId,
        senderId: params.senderId,
        message: params.message,
      },
    });
  });

  emitToMatch(params.matchId, 'chat.message', {
    matchId: params.matchId,
    message: {
      id: row.id,
      senderId: row.senderId,
      message: row.message,
      createdAt: row.createdAt,
    },
  });

  return row;
}
