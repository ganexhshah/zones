import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { resolveAccountRestriction } from '@/lib/account-status';
import {
  AdminAccess,
  ensureRouteAdminPermission,
  resolveAdminAccessForUser,
} from '@/lib/admin-access';

type AuthError = {
  error: string;
  status: 401 | 403 | 404;
  accountStatus?: any;
};

type AuthUserResult = {
  user: any;
  payload: { userId: string; isAdmin: boolean; isMainAdmin: boolean; permissions: string[] };
};

export async function requireAuthUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '') ?? req.cookies.get('auth_token')?.value;
  if (!token) return { error: 'Unauthorized', status: 401 as const } satisfies AuthError;

  const payload = verifyToken(token);
  if (!payload) return { error: 'Invalid token', status: 401 as const } satisfies AuthError;

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user) return { error: 'User not found', status: 404 as const } satisfies AuthError;

  const restriction = await resolveAccountRestriction(user);
  if (restriction) {
    return {
      error: restriction.status === 'SUSPENDED' ? 'Account suspended' : 'Account blocked',
      status: 403 as const,
      accountStatus: restriction,
    } satisfies AuthError;
  }

  return { user, payload } satisfies AuthUserResult;
}

export function requireAuthPayload(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '') ?? req.cookies.get('auth_token')?.value;
  if (!token) return { error: 'Unauthorized', status: 401 as const };
  const payload = verifyToken(token);
  if (!payload) return { error: 'Invalid token', status: 401 as const };
  return { payload };
}

export async function requireAdminUser(req: NextRequest) {
  const auth = await requireAuthUser(req);
  if ('error' in auth) return auth;

  const adminAccess = await resolveAdminAccessForUser({
    id: auth.user.id,
    email: auth.user.email,
  });
  if (!adminAccess) {
    return { error: 'Admin access required', status: 403 as const } satisfies AuthError;
  }

  const permissionError = ensureRouteAdminPermission(req, adminAccess);
  if (permissionError) return permissionError;

  return { ...auth, adminAccess } satisfies AuthUserResult & { adminAccess: AdminAccess };
}

