import {
  EscrowStatus,
  JoinRequestStatus,
  MatchStatus,
  Prisma,
  WalletLedgerType,
} from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { getCustomMatchOdds, getModeOdd } from '@/lib/custom-odds';
import { decryptText, encryptText } from '@/lib/match-v1/crypto';
import { emitMatchAndUsers, emitToUser } from '@/lib/match-v1/realtime';
import { sendPushToUser } from '@/lib/push';
import { getAdminEmailRecipients, sendEmail, sendEmailMany } from '@/lib/email';

function toNumber(v: Prisma.Decimal | number | string | null | undefined) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  return Number(v);
}

function now() {
  return new Date();
}

const RESULT_EDIT_WINDOW_SECONDS = 60;
const RESULT_TIMEOUT_MINUTES = 15;
const RESULT_NOTE_PREFIX = '__rc:';

type ResultChoice = 'won' | 'lost' | 'report_issue';
type ResultWorkflowStatus =
  | 'awaiting_results'
  | 'waiting_opponent'
  | 'pending_verification'
  | 'under_review'
  | 'timeout_pending_review'
  | 'conflict'
  | 'invalid_result'
  | 'admin_verified'
  | 'paid';

type ParsedResultNote = {
  resultChoice: ResultChoice;
  note: string | null;
  reportReason: string | null;
  reportDescription: string | null;
};

function encodeResultNote(params: {
  resultChoice: ResultChoice;
  note?: string | null;
  reportReason?: string | null;
  reportDescription?: string | null;
}) {
  const resultChoice = params.resultChoice;
  const cleaned = (params.note ?? '').trim();
  const payload = {
    resultChoice,
    note: cleaned || null,
    reportReason: (params.reportReason ?? '').trim() || null,
    reportDescription: (params.reportDescription ?? '').trim() || null,
  };
  return `${RESULT_NOTE_PREFIX}json__${JSON.stringify(payload)}`;
}

function parseResultNote(rawNote: string | null | undefined, claimedWinnerId: string, submittedBy: string): ParsedResultNote {
  const fallbackChoice: ResultChoice = claimedWinnerId === submittedBy ? 'won' : 'lost';
  const note = (rawNote ?? '').trim();
  if (!note.startsWith(RESULT_NOTE_PREFIX)) {
    return {
      resultChoice: fallbackChoice,
      note: note || null,
      reportReason: null,
      reportDescription: null,
    };
  }

  if (note.startsWith(`${RESULT_NOTE_PREFIX}json__`)) {
    const rawJson = note.slice(`${RESULT_NOTE_PREFIX}json__`.length).trim();
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      const parsedChoiceRaw = (parsed.resultChoice ?? '').toString();
      const parsedChoice: ResultChoice =
        parsedChoiceRaw === 'won' || parsedChoiceRaw === 'lost' || parsedChoiceRaw === 'report_issue'
          ? parsedChoiceRaw
          : fallbackChoice;
      return {
        resultChoice: parsedChoice,
        note: (parsed.note ?? '').toString().trim() || null,
        reportReason: (parsed.reportReason ?? '').toString().trim() || null,
        reportDescription: (parsed.reportDescription ?? '').toString().trim() || null,
      };
    } catch {
      return {
        resultChoice: fallbackChoice,
        note: note || null,
        reportReason: null,
        reportDescription: null,
      };
    }
  }

  const endMarker = note.indexOf('__', RESULT_NOTE_PREFIX.length);
  if (endMarker < 0) {
    return {
      resultChoice: fallbackChoice,
      note: note || null,
      reportReason: null,
      reportDescription: null,
    };
  }

  const choiceRaw = note.slice(RESULT_NOTE_PREFIX.length, endMarker).trim();
  const parsedChoice: ResultChoice =
    choiceRaw === 'won' || choiceRaw === 'lost' || choiceRaw === 'report_issue'
      ? choiceRaw
      : fallbackChoice;
  const remaining = note.slice(endMarker + 2).trim();

  return {
    resultChoice: parsedChoice,
    note: remaining || null,
    reportReason: null,
    reportDescription: null,
  };
}

function getResultStatusMeta(meta: unknown): {
  resultStatus?: ResultWorkflowStatus;
  resultDeadlineAt?: string | null;
  revealResults?: boolean;
  winnerUserId?: string | null;
} {
  if (!meta || typeof meta !== 'object') return {};
  const obj = meta as Record<string, unknown>;
  const resultStatusRaw = typeof obj.resultStatus === 'string' ? obj.resultStatus : undefined;
  const isKnownStatus = (
    resultStatusRaw === 'awaiting_results' ||
    resultStatusRaw === 'waiting_opponent' ||
    resultStatusRaw === 'pending_verification' ||
    resultStatusRaw === 'under_review' ||
    resultStatusRaw === 'timeout_pending_review' ||
    resultStatusRaw === 'conflict' ||
    resultStatusRaw === 'invalid_result' ||
    resultStatusRaw === 'admin_verified' ||
    resultStatusRaw === 'paid'
  );
  return {
    resultStatus: isKnownStatus ? resultStatusRaw : undefined,
    resultDeadlineAt: typeof obj.resultDeadlineAt === 'string' ? obj.resultDeadlineAt : null,
    revealResults: obj.revealResults === true,
    winnerUserId: typeof obj.winnerUserId === 'string' ? obj.winnerUserId : null,
  };
}

function evaluateResultWorkflow(params: {
  creatorId: string;
  joinerId: string;
  creatorChoice?: ResultChoice | null;
  joinerChoice?: ResultChoice | null;
}): { status: ResultWorkflowStatus; winnerUserId: string | null; revealResults: boolean } {
  const { creatorChoice, joinerChoice, creatorId, joinerId } = params;

  if (!creatorChoice && !joinerChoice) {
    return {
      status: 'awaiting_results',
      winnerUserId: null,
      revealResults: false,
    };
  }

  if (!creatorChoice || !joinerChoice) {
    return {
      status: 'waiting_opponent',
      winnerUserId: null,
      revealResults: false,
    };
  }

  if (creatorChoice === 'report_issue' || joinerChoice === 'report_issue') {
    return { status: 'under_review', winnerUserId: null, revealResults: true };
  }

  if (creatorChoice === 'won' && joinerChoice === 'lost') {
    return { status: 'pending_verification', winnerUserId: creatorId, revealResults: true };
  }
  if (creatorChoice === 'lost' && joinerChoice === 'won') {
    return { status: 'pending_verification', winnerUserId: joinerId, revealResults: true };
  }
  if (creatorChoice === 'won' && joinerChoice === 'won') {
    return { status: 'conflict', winnerUserId: null, revealResults: true };
  }
  if (creatorChoice === 'lost' && joinerChoice === 'lost') {
    return { status: 'invalid_result', winnerUserId: null, revealResults: true };
  }
  return { status: 'under_review', winnerUserId: null, revealResults: true };
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
}) {
  ensurePositiveDecimal(params.entryFee, 'entryFee');

  const customOdds = await getCustomMatchOdds();
  const modeOdd = getModeOdd(customOdds, params.matchType);
  const entryFee = new Prisma.Decimal(params.entryFee);
  const prizePool = entryFee.mul(new Prisma.Decimal(modeOdd));

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

export async function listMatches(params: { status?: MatchStatus; limit: number; requesterId: string }) {
  const visibilityWhere: Prisma.MatchWhereInput = {
    OR: [
      { creatorId: params.requesterId },
      { joinerId: params.requesterId },
      { status: MatchStatus.OPEN },
    ],
  };
  const where: Prisma.MatchWhereInput = params.status
    ? { AND: [visibilityWhere, { status: params.status }] }
    : visibilityWhere;

  const rows = await prisma.match.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: params.limit,
    include: {
      creator: { select: { id: true, name: true, avatar: true } },
      joiner: { select: { id: true, name: true, avatar: true } },
      joinRequests: { orderBy: { createdAt: 'desc' }, take: 1 },
      logs: {
        where: { action: 'RESULT_SUBMITTED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          performer: { select: { id: true, name: true, avatar: true } },
        },
      },
    },
  });

  return rows.map((match) => {
    const roomVisible = canViewRoom(params.requesterId, match);
    if (!roomVisible || !match.roomIdEncrypted || !match.roomPassEncrypted) {
      return {
        ...match,
        roomIdMasked: null,
        roomPasswordMasked: null,
      };
    }

    try {
      const roomId = decryptText(match.roomIdEncrypted);
      const roomPassword = decryptText(match.roomPassEncrypted);
      return {
        ...match,
        // Return full credentials to participants, not masked
        roomIdMasked: roomId,
        roomPasswordMasked: roomPassword,
      };
    } catch (error) {
      console.error('Failed to decrypt room credentials for match list:', {
        matchId: match.id,
        requesterId: params.requesterId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      ...match,
      roomIdMasked: null,
      roomPasswordMasked: null,
    };
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
      resultClaims: {
        include: {
          submitter: { select: { id: true, name: true, avatar: true } },
          claimedWinner: { select: { id: true, name: true, avatar: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      logs: {
        where: { action: { in: ['RESULT_SUBMITTED', 'RESULT_WORKFLOW_UPDATED', 'RESULT_REVIEWED', 'MATCH_COMPLETED'] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          performer: { select: { id: true, name: true, avatar: true } },
        },
      },
    },
  });

  if (!match) return null;
  const isParticipant = requesterId === match.creatorId || requesterId === match.joinerId;
  if (!isParticipant && match.status !== MatchStatus.OPEN) {
    throw new Error('FORBIDDEN');
  }

  const roomVisible = canViewRoom(requesterId, match);
  let roomId: string | null = null;
  let roomPassword: string | null = null;

  if (roomVisible && match.roomIdEncrypted && match.roomPassEncrypted) {
    try {
      roomId = decryptText(match.roomIdEncrypted);
      roomPassword = decryptText(match.roomPassEncrypted);
    } catch (error) {
      console.error('Failed to decrypt room credentials for match details:', {
        matchId,
        requesterId,
        error: error instanceof Error ? error.message : String(error),
      });
      roomId = null;
      roomPassword = null;
    }
  }

  const latestSubmissionLog = match.logs.find((log) => log.action === 'RESULT_SUBMITTED');
  const latestWorkflowLog = match.logs.find((log) => log.action === 'RESULT_WORKFLOW_UPDATED');
  const latestReviewLog = match.logs.find((log) => log.action === 'RESULT_REVIEWED');
  const latestCompletionLog = match.logs.find((log) => log.action === 'MATCH_COMPLETED');

  const claimsWithChoice = (match.resultClaims || []).map((claim) => {
    const parsed = parseResultNote(claim.note, claim.claimedWinnerId, claim.submittedBy);
    return {
      ...claim,
      resultChoice: parsed.resultChoice,
      note: parsed.note,
      reportReason: parsed.reportReason,
      reportDescription: parsed.reportDescription,
    };
  });

  const creatorClaim = claimsWithChoice.find((claim) => claim.submittedBy === match.creatorId);
  const joinerClaim = claimsWithChoice.find((claim) => claim.submittedBy === match.joinerId);
  const firstSubmittedClaim = claimsWithChoice
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
  const deadlineAt = firstSubmittedClaim
    ? new Date(firstSubmittedClaim.createdAt.getTime() + RESULT_TIMEOUT_MINUTES * 60 * 1000)
    : null;
  const timeoutReached = deadlineAt ? now().getTime() > deadlineAt.getTime() : false;

  let computedState = evaluateResultWorkflow({
    creatorId: match.creatorId,
    joinerId: match.joinerId ?? '',
    creatorChoice: creatorClaim?.resultChoice,
    joinerChoice: joinerClaim?.resultChoice,
  });
  if (computedState.status === 'waiting_opponent' && timeoutReached && firstSubmittedClaim) {
    if (firstSubmittedClaim.resultChoice === 'won') {
      const hasProof = Boolean(firstSubmittedClaim.proofUrl && firstSubmittedClaim.proofUrl.trim());
      const recentFraudFlags = await prisma.fraudFlag.count({
        where: {
          userId: firstSubmittedClaim.submittedBy,
          createdAt: { gte: new Date(now().getTime() - 30 * 24 * 60 * 60 * 1000) },
        },
      });
      computedState = hasProof && recentFraudFlags === 0
        ? {
            status: 'pending_verification',
            winnerUserId: firstSubmittedClaim.submittedBy,
            revealResults: true,
          }
        : {
            status: 'under_review',
            winnerUserId: null,
            revealResults: true,
          };
    } else if (firstSubmittedClaim.resultChoice === 'lost') {
      computedState = {
        status: 'timeout_pending_review',
        winnerUserId: null,
        revealResults: true,
      };
    } else {
      computedState = {
        status: 'under_review',
        winnerUserId: null,
        revealResults: true,
      };
    }
  }
  const workflowMeta = getResultStatusMeta(latestWorkflowLog?.meta);
  const reviewMeta = getResultStatusMeta(latestReviewLog?.meta);
  const workflowStatus: ResultWorkflowStatus =
    reviewMeta.resultStatus ??
    workflowMeta.resultStatus ??
    computedState.status;
  const workflowWinnerUserId = reviewMeta.winnerUserId ?? workflowMeta.winnerUserId ?? computedState.winnerUserId;
  const workflowDeadlineAt =
    reviewMeta.resultDeadlineAt ??
    workflowMeta.resultDeadlineAt ??
    (deadlineAt ? deadlineAt.toISOString() : null);
  const revealResults =
    reviewMeta.revealResults === true ||
    workflowMeta.revealResults === true ||
    computedState.revealResults ||
    match.status === MatchStatus.COMPLETED;

  const resultSubmission = latestSubmissionLog
    ? {
        status: workflowStatus,
        resultDeadlineAt: workflowDeadlineAt,
        revealResults,
        submittedAt: latestSubmissionLog.createdAt,
        submittedBy: latestSubmissionLog.performer
          ? {
              id: latestSubmissionLog.performer.id,
              name: latestSubmissionLog.performer.name,
              avatar: latestSubmissionLog.performer.avatar,
            }
          : null,
        winnerUserId:
          workflowWinnerUserId ??
          (
            latestSubmissionLog.meta &&
            typeof latestSubmissionLog.meta === 'object' &&
            'winnerUserId' in latestSubmissionLog.meta
              ? (latestSubmissionLog.meta as { winnerUserId?: string }).winnerUserId ?? null
              : null
          ),
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
    // Return full credentials to participants, not masked
    roomIdMasked: roomId,
    roomPasswordMasked: roomPassword,
    resultSubmission,
    completion,
    resultClaims: isParticipant && !revealResults
      ? claimsWithChoice.filter((claim) => claim.submittedBy === requesterId)
      : claimsWithChoice,
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

export async function acceptJoinRequestWithRoom(params: {
  matchId: string;
  creatorId: string;
  roomId: string;
  roomPassword: string;
}) {
  const { matchId, creatorId, roomId, roomPassword } = params;

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
      data: {
        status: MatchStatus.CONFIRMED,
        expiresAt: null,
        roomIdEncrypted: encryptText(roomId),
        roomPassEncrypted: encryptText(roomPassword),
      },
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

    await tx.matchLog.create({
      data: {
        matchId,
        action: 'ROOM_SUBMITTED',
        performedBy: creatorId,
      },
    });

    return { updated, joinerId: match.joinerId };
  });

  emitMatchAndUsers({
    matchId,
    userIds: [creatorId, result.joinerId],
    event: 'match.room_ready',
    payload: {
      matchId,
      status: MatchStatus.CONFIRMED,
      // Send full credentials to participants, not masked
      roomIdMasked: roomId,
      roomPasswordMasked: roomPassword,
    },
  });

  await Promise.allSettled([
    notifyUser({
      userId: creatorId,
      title: 'Match Confirmed',
      body: 'Join request accepted and room details shared.',
      data: {
        event: 'match_confirmed_creator',
        matchId,
        status: MatchStatus.CONFIRMED,
      },
    }),
    notifyUser({
      userId: result.joinerId,
      title: 'Match Ready',
      body: 'Your request was accepted. Room details are now available.',
      data: {
        event: 'match_confirmed_joiner',
        matchId,
        status: MatchStatus.CONFIRMED,
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
        // Send full credentials to participants, not masked
        roomIdMasked: params.roomId,
        roomPasswordMasked: params.roomPassword,
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
  resultChoice: ResultChoice;
  hasScreenshot: boolean;
  note?: string;
  reportReason?: string;
  reportDescription?: string;
  proofUrl?: string;
}) {
  const normalizedProofUrl = params.proofUrl?.trim() ? params.proofUrl.trim() : null;
  const requiresProof =
    params.resultChoice === 'won' ||
    params.resultChoice === 'report_issue' ||
    params.hasScreenshot;
  if (requiresProof && !normalizedProofUrl) {
    throw new Error('PROOF_REQUIRED');
  }
  if (params.resultChoice === 'report_issue') {
    if (!params.reportReason?.trim() || !params.reportDescription?.trim()) {
      throw new Error('REPORT_REASON_REQUIRED');
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    await lockMatchRow(tx, params.matchId);
    const match = await tx.match.findUniqueOrThrow({ where: { id: params.matchId } });
    if (match.status !== MatchStatus.CONFIRMED) throw new Error('INVALID_STATUS');
    if (!match.joinerId) throw new Error('NO_JOINER');

    if (params.submittedBy !== match.creatorId && params.submittedBy !== match.joinerId) {
      throw new Error('FORBIDDEN');
    }

    const opponentId = params.submittedBy === match.creatorId ? match.joinerId : match.creatorId;
    const claimedWinnerId =
      params.resultChoice === 'won'
        ? params.submittedBy
        : params.resultChoice === 'lost'
          ? opponentId
          : params.submittedBy;

    const existing = await tx.matchResultClaim.findUnique({
      where: {
        matchId_submittedBy: {
          matchId: params.matchId,
          submittedBy: params.submittedBy,
        },
      },
    });

    const encodedNote = encodeResultNote({
      resultChoice: params.resultChoice,
      note: params.note ?? null,
      reportReason: params.reportReason ?? null,
      reportDescription: params.reportDescription ?? null,
    });
    const currentTime = now();
    if (existing) {
      const editWindowMs = RESULT_EDIT_WINDOW_SECONDS * 1000;
      const editableUntil = existing.createdAt.getTime() + editWindowMs;
      if (currentTime.getTime() > editableUntil) {
        throw new Error('RESULT_EDIT_WINDOW_EXPIRED');
      }
      await tx.matchResultClaim.update({
        where: { id: existing.id },
        data: {
          claimedWinnerId,
          proofUrl: requiresProof ? normalizedProofUrl : null,
          note: encodedNote,
          status: 'PENDING',
          rejectionReason: null,
        },
      });
    } else {
      await tx.matchResultClaim.create({
        data: {
          matchId: params.matchId,
          submittedBy: params.submittedBy,
          claimedWinnerId,
          proofUrl: requiresProof ? normalizedProofUrl : null,
          note: encodedNote,
          status: 'PENDING',
        },
      });
    }

    const claims = await tx.matchResultClaim.findMany({
      where: { matchId: params.matchId },
      orderBy: { createdAt: 'asc' },
    });
    const creatorClaim = claims.find((claim) => claim.submittedBy === match.creatorId);
    const joinerClaim = claims.find((claim) => claim.submittedBy === match.joinerId);
    const creatorParsed = creatorClaim
      ? parseResultNote(creatorClaim.note, creatorClaim.claimedWinnerId, creatorClaim.submittedBy)
      : null;
    const joinerParsed = joinerClaim
      ? parseResultNote(joinerClaim.note, joinerClaim.claimedWinnerId, joinerClaim.submittedBy)
      : null;

    const workflow = evaluateResultWorkflow({
      creatorId: match.creatorId,
      joinerId: match.joinerId,
      creatorChoice: creatorParsed?.resultChoice,
      joinerChoice: joinerParsed?.resultChoice,
    });
    const firstSubmissionAt = claims[0]?.createdAt ?? currentTime;
    const deadlineAt = new Date(firstSubmissionAt.getTime() + RESULT_TIMEOUT_MINUTES * 60 * 1000);

    await tx.matchLog.create({
      data: {
        matchId: params.matchId,
        action: 'RESULT_SUBMITTED',
        performedBy: params.submittedBy,
        meta: {
          resultChoice: params.resultChoice,
          hasScreenshot: requiresProof,
          winnerUserId: workflow.winnerUserId,
          note: (params.note ?? '').trim() || null,
          reportReason: (params.reportReason ?? '').trim() || null,
          reportDescription: (params.reportDescription ?? '').trim() || null,
          proofUrl: requiresProof ? normalizedProofUrl : null,
          resultStatus: workflow.status,
          resultDeadlineAt: deadlineAt.toISOString(),
          revealResults: workflow.revealResults,
        },
      },
    });

    await tx.matchLog.create({
      data: {
        matchId: params.matchId,
        action: 'RESULT_WORKFLOW_UPDATED',
        performedBy: params.submittedBy,
        meta: {
          resultStatus: workflow.status,
          winnerUserId: workflow.winnerUserId,
          resultDeadlineAt: deadlineAt.toISOString(),
          revealResults: workflow.revealResults,
        },
      },
    });

    return {
      submitted: true,
      creatorId: match.creatorId,
      joinerId: match.joinerId,
      workflowStatus: workflow.status,
      winnerUserId: workflow.winnerUserId,
      revealResults: workflow.revealResults,
    };
  });

  if (result.joinerId) {
    const notifyTargets = [result.creatorId, result.joinerId];
    await Promise.allSettled(
      notifyTargets.map((userId) =>
        notifyUser({
          userId,
          title: 'Result Submitted',
          body:
            result.workflowStatus === 'waiting_opponent'
              ? 'Result submitted. Waiting for opponent submission.'
              : 'Result submitted. Waiting for admin verification.',
          data: {
            event: 'result_submitted',
            matchId: params.matchId,
            status: MatchStatus.CONFIRMED,
            resultStatus: result.workflowStatus,
          },
        })
      )
    );
  }

  return {
    submitted: true,
    resultStatus: result.workflowStatus,
    winnerUserId: result.winnerUserId,
    revealResults: result.revealResults,
  };
}

export async function reportMatchIssue(params: {
  matchId: string;
  reportedBy: string;
  reason: string;
  details?: string;
  proofUrl?: string;
}) {
  const result = await prisma.$transaction(async (tx) => {
    await lockMatchRow(tx, params.matchId);
    const match = await tx.match.findUniqueOrThrow({
      where: { id: params.matchId },
      include: {
        creator: { select: { id: true, name: true, email: true } },
        joiner: { select: { id: true, name: true, email: true } },
      },
    });

    const reporter = await tx.user.findUnique({
      where: { id: params.reportedBy },
      select: { id: true, name: true, email: true },
    });

    if (params.reportedBy !== match.creatorId && params.reportedBy !== match.joinerId) {
      throw new Error('FORBIDDEN');
    }

    await tx.matchLog.create({
      data: {
        matchId: params.matchId,
        action: 'MATCH_REPORTED',
        performedBy: params.reportedBy,
        meta: {
          status: 'SUBMITTED',
          reason: params.reason,
          details: params.details ?? null,
          proofUrl: params.proofUrl ?? null,
        },
      },
    });

    return {
      creatorId: match.creatorId,
      joinerId: match.joinerId,
      status: match.status,
      gameName: match.gameName,
      reporterName: reporter?.name ?? 'Player',
      reporterEmail: reporter?.email ?? '',
      creatorEmail: match.creator.email ?? '',
      joinerEmail: match.joiner?.email ?? '',
    };
  });

  if (result.joinerId) {
    await Promise.allSettled([
      notifyUser({
        userId: result.creatorId,
        title: 'Match Report Submitted',
        body: 'A report was submitted for this custom match.',
        data: {
          event: 'match_reported_creator',
          matchId: params.matchId,
          status: result.status,
        },
      }),
      notifyUser({
        userId: result.joinerId,
        title: 'Match Report Submitted',
        body: 'A report was submitted for this custom match.',
        data: {
          event: 'match_reported_joiner',
          matchId: params.matchId,
          status: result.status,
        },
      }),
    ]);
  }

  const shortMatchId = params.matchId.length > 10 ? params.matchId.slice(0, 10) : params.matchId;
  if (result.reporterEmail) {
    await sendEmail(
      result.reporterEmail,
      'Custom Match Report Received - Crackzone',
      `
      <div style="font-family: Arial, sans-serif; padding: 16px;">
        <h2>Report submitted</h2>
        <p>Hello ${result.reporterName},</p>
        <p>We received your custom match report.</p>
        <p><strong>Match:</strong> ${result.gameName} (${shortMatchId})</p>
        <p><strong>Reason:</strong> ${params.reason}</p>
        <p>Our team will review and update the report status.</p>
      </div>
      `,
    );
  }

  const adminEmails = getAdminEmailRecipients();
  if (adminEmails.length > 0) {
    await sendEmailMany(
      adminEmails,
      'New Custom Match Report Submitted',
      `
      <div style="font-family: Arial, sans-serif; padding: 16px;">
        <h2>New custom match report</h2>
        <p><strong>Reporter:</strong> ${result.reporterName}</p>
        <p><strong>Match ID:</strong> ${params.matchId}</p>
        <p><strong>Game:</strong> ${result.gameName}</p>
        <p><strong>Reason:</strong> ${params.reason}</p>
        <p><strong>Details:</strong> ${params.details ?? 'N/A'}</p>
      </div>
      `,
    );
  }

  return { reported: true };
}

export async function verifyMatchAndPayout(params: {
  matchId: string;
  verifiedBy: string;
  winnerUserId: string;
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
    const configuredPrizePool = Prisma.Decimal.min(
      total,
      Prisma.Decimal.max(new Prisma.Decimal(0), new Prisma.Decimal(match.prizePool)),
    );
    const winnerCredit = configuredPrizePool;
    const fee = total.minus(winnerCredit);

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

export async function reviewMatchResult(params: {
  matchId: string;
  reviewedBy: string;
  action: 'approve_winner' | 'refund_both' | 'cancel_match';
  winnerUserId?: string;
  note?: string;
}) {
  if (params.action === 'approve_winner') {
    if (!params.winnerUserId) throw new Error('WINNER_REQUIRED');
    await verifyMatchAndPayout({
      matchId: params.matchId,
      verifiedBy: params.reviewedBy,
      winnerUserId: params.winnerUserId,
    });
    await prisma.matchLog.create({
      data: {
        matchId: params.matchId,
        action: 'RESULT_REVIEWED',
        performedBy: params.reviewedBy,
        meta: {
          action: params.action,
          winnerUserId: params.winnerUserId,
          note: (params.note ?? '').trim() || null,
          resultStatus: 'paid',
          adminStatus: 'admin_verified',
        },
      },
    });
    return {
      action: params.action,
      status: 'paid',
      winnerUserId: params.winnerUserId,
    };
  }

  const settlement = await prisma.$transaction(async (tx) => {
    await lockMatchRow(tx, params.matchId);
    const match = await tx.match.findUniqueOrThrow({ where: { id: params.matchId } });
    if (!match.joinerId) throw new Error('NO_JOINER');
    if (match.status !== MatchStatus.CONFIRMED) throw new Error('INVALID_STATUS');

    const escrow = await tx.escrow.findFirst({
      where: { matchId: params.matchId, status: EscrowStatus.LOCKED },
    });
    if (!escrow) throw new Error('ESCROW_NOT_FOUND');

    await lockUserRow(tx, match.creatorId);
    await lockUserRow(tx, match.joinerId);
    const creator = await tx.user.findUniqueOrThrow({ where: { id: match.creatorId } });
    const joiner = await tx.user.findUniqueOrThrow({ where: { id: match.joinerId } });
    const entryFee = new Prisma.Decimal(match.entryFee);

    const creatorNext = new Prisma.Decimal(creator.availableBalance).plus(entryFee);
    const joinerNext = new Prisma.Decimal(joiner.availableBalance).plus(entryFee);
    await applyAvailableOnlyState(tx, creator.id, creatorNext);
    await applyAvailableOnlyState(tx, joiner.id, joinerNext);

    await appendLedger({
      tx,
      userId: creator.id,
      matchId: match.id,
      type: WalletLedgerType.REFUND,
      amount: entryFee,
      balanceAfter: creatorNext,
    });
    await appendLedger({
      tx,
      userId: joiner.id,
      matchId: match.id,
      type: WalletLedgerType.REFUND,
      amount: entryFee,
      balanceAfter: joinerNext,
    });

    await tx.escrow.updateMany({
      where: { matchId: match.id, status: EscrowStatus.LOCKED },
      data: { status: EscrowStatus.REFUNDED },
    });

    await tx.match.update({
      where: { id: match.id },
      data: {
        status: params.action === 'cancel_match' ? MatchStatus.CANCELLED : MatchStatus.COMPLETED,
        completedAt: now(),
      },
    });

    await tx.matchLog.create({
      data: {
        matchId: match.id,
        action: params.action === 'cancel_match' ? 'MATCH_CANCELLED' : 'MATCH_REFUNDED',
        performedBy: params.reviewedBy,
        meta: {
          adminAction: params.action,
          note: (params.note ?? '').trim() || null,
        },
      },
    });

    await tx.matchLog.create({
      data: {
        matchId: match.id,
        action: 'RESULT_REVIEWED',
        performedBy: params.reviewedBy,
        meta: {
          action: params.action,
          note: (params.note ?? '').trim() || null,
          resultStatus: 'admin_verified',
          adminStatus: 'admin_verified',
        },
      },
    });

    return {
      creatorId: match.creatorId,
      joinerId: match.joinerId,
      matchStatus: params.action === 'cancel_match' ? MatchStatus.CANCELLED : MatchStatus.COMPLETED,
    };
  });

  emitMatchAndUsers({
    matchId: params.matchId,
    userIds: [settlement.creatorId, settlement.joinerId],
    event: 'match.completed',
    payload: {
      matchId: params.matchId,
      status: settlement.matchStatus,
      resultStatus: 'admin_verified',
      action: params.action,
    },
  });
  emitToUser(settlement.creatorId, 'wallet.updated', { matchId: params.matchId, reason: 'MATCH_REVIEWED' });
  emitToUser(settlement.joinerId, 'wallet.updated', { matchId: params.matchId, reason: 'MATCH_REVIEWED' });

  return {
    action: params.action,
    status: 'admin_verified',
    winnerUserId: null,
  };
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
  const result = await prisma.$transaction(async (tx) => {
    await lockMatchRow(tx, params.matchId);
    const match = await tx.match.findUniqueOrThrow({ where: { id: params.matchId } });

    if (![match.creatorId, match.joinerId].includes(params.senderId)) throw new Error('FORBIDDEN');
    if (match.status !== MatchStatus.CONFIRMED) throw new Error('CHAT_DISABLED');

    const row = await tx.chatMessage.create({
      data: {
        matchId: params.matchId,
        senderId: params.senderId,
        message: params.message,
      },
    });
    return {
      row,
      creatorId: match.creatorId,
      joinerId: match.joinerId,
    };
  });

  const payload = {
    matchId: params.matchId,
    message: {
      id: result.row.id,
      senderId: result.row.senderId,
      message: result.row.message,
      createdAt: result.row.createdAt,
    },
  };

  emitToUser(result.creatorId, 'chat.message', payload);
  if (result.joinerId) {
    emitToUser(result.joinerId, 'chat.message', payload);
  }

  return result.row;
}
