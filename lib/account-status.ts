import { prisma } from '@/lib/prisma';

type UserStatusShape = {
  id: string;
  isBlocked: boolean;
  blockReason: string | null;
  suspendedUntil: Date | null;
};

export type AccountRestriction =
  | null
  | {
      status: 'BLOCKED' | 'SUSPENDED';
      reason: string;
      suspendedUntil: string | null;
      daysRemaining: number | null;
      canRequestUnblock: boolean;
    };

function dayDiffCeil(later: Date, earlier: Date) {
  const diffMs = later.getTime() - earlier.getTime();
  return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

export async function resolveAccountRestriction(
  user: UserStatusShape,
): Promise<AccountRestriction> {
  if (!user.isBlocked) return null;

  const now = new Date();
  if (user.suspendedUntil && user.suspendedUntil.getTime() <= now.getTime()) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isBlocked: false,
        blockReason: null,
        suspendedUntil: null,
      },
    });
    return null;
  }

  const reason = (user.blockReason || '').trim() || 'No reason provided by admin.';
  if (user.suspendedUntil) {
    return {
      status: 'SUSPENDED',
      reason,
      suspendedUntil: user.suspendedUntil.toISOString(),
      daysRemaining: dayDiffCeil(user.suspendedUntil, now),
      canRequestUnblock: true,
    };
  }

  return {
    status: 'BLOCKED',
    reason,
    suspendedUntil: null,
    daysRemaining: null,
    canRequestUnblock: true,
  };
}
