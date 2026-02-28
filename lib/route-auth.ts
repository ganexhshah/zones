import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

export async function requireAuthUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { error: 'Unauthorized', status: 401 as const };

  const payload = verifyToken(token);
  if (!payload) return { error: 'Invalid token', status: 401 as const };

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user) return { error: 'User not found', status: 404 as const };

  return { user, payload };
}

export function requireAuthPayload(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { error: 'Unauthorized', status: 401 as const };
  const payload = verifyToken(token);
  if (!payload) return { error: 'Invalid token', status: 401 as const };
  return { payload };
}

function parseCsvEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export async function requireAdminUser(req: NextRequest) {
  const auth = await requireAuthUser(req);
  if ('error' in auth) return auth;

  const allowedEmails = new Set<string>([
    ...parseCsvEnv(process.env.ADMIN_EMAILS),
    ...parseCsvEnv(process.env.ADMIN_EMAIL),
  ]);
  const allowedUserIds = new Set<string>([
    ...parseCsvEnv(process.env.ADMIN_USER_IDS),
    ...parseCsvEnv(process.env.ADMIN_USER_ID),
  ]);

  const isAllowed =
    allowedUserIds.has(auth.user.id) ||
    (!!auth.user.email && allowedEmails.has(auth.user.email));

  if (!isAllowed) {
    return { error: 'Admin access required', status: 403 as const };
  }

  return auth;
}
