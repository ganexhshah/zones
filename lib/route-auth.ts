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
