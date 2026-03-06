import { NextRequest } from 'next/server';
import { MatchStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireAdminUser } from '@/lib/route-auth';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireAdminUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const { id } = params;
    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        joiner: { select: { id: true, name: true, avatar: true } },
        joinRequests: { orderBy: { createdAt: 'desc' } },
        escrows: { orderBy: { createdAt: 'desc' }, take: 1 },
        walletLedger: {
          orderBy: { createdAt: 'desc' },
          take: 200,
          include: {
            user: {
              select: { id: true, name: true, email: true, avatar: true },
            },
          },
        },
        resultClaims: {
          include: {
            submitter: { select: { id: true, name: true, avatar: true } },
            claimedWinner: { select: { id: true, name: true, avatar: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        logs: {
          orderBy: { createdAt: 'desc' },
          take: 200,
          include: {
            performer: { select: { id: true, name: true, avatar: true } },
          },
        },
        chatMessages: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: {
            sender: { select: { id: true, name: true, avatar: true } },
          },
        },
      },
    });

    if (!match) return fail('Match not found', 404);

    // Build result submission from logs for backward compatibility
    const latestSubmissionLog = match.logs.find((log) => log.action === 'RESULT_SUBMITTED');
    const latestWorkflowLog = match.logs.find((log) => log.action === 'RESULT_WORKFLOW_UPDATED');
    const latestReviewLog = match.logs.find((log) => log.action === 'RESULT_REVIEWED');
    const latestCompletionLog = match.logs.find((log) => log.action === 'MATCH_COMPLETED');
    const workflowMeta = (latestReviewLog?.meta || latestWorkflowLog?.meta) as Record<string, unknown> | null;

    const resultSubmission = latestSubmissionLog
      ? {
          status: (workflowMeta?.resultStatus as string | undefined) ?? 'waiting_opponent',
          resultDeadlineAt: (workflowMeta?.resultDeadlineAt as string | undefined) ?? null,
          revealResults: workflowMeta?.revealResults === true,
          submittedAt: latestSubmissionLog.createdAt,
          submittedBy: latestSubmissionLog.performer
            ? {
                id: latestSubmissionLog.performer.id,
                name: latestSubmissionLog.performer.name,
                avatar: latestSubmissionLog.performer.avatar,
              }
            : null,
          winnerUserId:
            (workflowMeta?.winnerUserId as string | undefined) ??
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

    const participantUserIds = [match.creatorId, match.joinerId].filter(
      (userId): userId is string => Boolean(userId),
    );
    const relatedTransactions = await prisma.transaction.findMany({
      where: {
        OR: [
          { reference: { contains: match.id, mode: 'insensitive' } },
          { userId: { in: participantUserIds } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
    });

    return ok({
      match: {
        ...match,
        resultSubmission,
        completion,
        resultClaims: (match.resultClaims || []).map((claim) => {
          const noteRaw = (claim.note ?? '').trim();
          const fallbackChoice = claim.claimedWinnerId === claim.submittedBy ? 'won' : 'lost';
          if (noteRaw.startsWith('__rc:json__')) {
            const rawJson = noteRaw.slice('__rc:json__'.length).trim();
            try {
              const parsed = JSON.parse(rawJson) as Record<string, unknown>;
              const choiceRaw = (parsed.resultChoice ?? '').toString();
              const resultChoice =
                choiceRaw === 'won' || choiceRaw === 'lost' || choiceRaw === 'report_issue'
                  ? choiceRaw
                  : fallbackChoice;
              return {
                ...claim,
                resultChoice,
                note: (parsed.note ?? '').toString().trim() || null,
                reportReason: (parsed.reportReason ?? '').toString().trim() || null,
                reportDescription: (parsed.reportDescription ?? '').toString().trim() || null,
              };
            } catch {
              return {
                ...claim,
                resultChoice: fallbackChoice,
                note: noteRaw || null,
                reportReason: null,
                reportDescription: null,
              };
            }
          }
          if (!noteRaw.startsWith('__rc:')) {
            return {
              ...claim,
              resultChoice: fallbackChoice,
              note: noteRaw || null,
              reportReason: null,
              reportDescription: null,
            };
          }
          const marker = noteRaw.indexOf('__', 5);
          if (marker < 0) {
            return {
              ...claim,
              resultChoice: fallbackChoice,
              note: noteRaw || null,
              reportReason: null,
              reportDescription: null,
            };
          }
          const choiceRaw = noteRaw.slice(5, marker).trim();
          const resultChoice =
            choiceRaw === 'won' || choiceRaw === 'lost' || choiceRaw === 'report_issue'
              ? choiceRaw
              : fallbackChoice;
          return {
            ...claim,
            resultChoice,
            note: noteRaw.slice(marker + 2).trim() || null,
            reportReason: null,
            reportDescription: null,
          };
        }),
        relatedTransactions,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireAdminUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const { id } = params;
    const match = await prisma.match.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!match) return fail('Match not found', 404);

    await prisma.match.delete({
      where: { id },
    });

    return ok({
      deleted: true,
      matchId: id,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const allowedStatuses = new Set<MatchStatus>([
  'OPEN',
  'PENDING_APPROVAL',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireAdminUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const { id } = params;
    const body = (await req.json().catch(() => ({}))) as { status?: string };
    const status = (body.status || '').toUpperCase() as MatchStatus;

    if (!allowedStatuses.has(status)) {
      return fail('Invalid status', 400);
    }

    const existing = await prisma.match.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!existing) return fail('Match not found', 404);

    const updated = await prisma.match.update({
      where: { id },
      data: { status },
      select: { id: true, status: true, updatedAt: true },
    });

    return ok({ match: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
