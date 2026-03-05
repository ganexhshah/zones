import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

export const ADMIN_PERMISSIONS = [
  'dashboard',
  'users',
  'tournaments',
  'payments',
  'gifts',
  'transactions',
  'custom_management',
  'notifications',
  'documents',
  'activity_logs',
  'wallet_reports',
  'match_reports',
  'finance_management',
  'analytics',
  'profile',
  'settings',
  'sub_admin_manage',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export type AdminAccess = {
  isAdmin: boolean;
  isMainAdmin: boolean;
  isSubAdmin: boolean;
  permissions: AdminPermission[];
  subAdminId?: string;
};

function parseCsvEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function normalizePermissions(input: unknown): AdminPermission[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<AdminPermission>();
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const key = item.trim() as AdminPermission;
    if (ADMIN_PERMISSIONS.includes(key)) set.add(key);
  }
  return Array.from(set);
}

export function isMainAdminByEnv(user: { id: string; email: string | null }) {
  const allowedEmails = new Set<string>([
    ...parseCsvEnv(process.env.ADMIN_EMAILS),
    ...parseCsvEnv(process.env.ADMIN_EMAIL),
  ]);
  const allowedUserIds = new Set<string>([
    ...parseCsvEnv(process.env.ADMIN_USER_IDS),
    ...parseCsvEnv(process.env.ADMIN_USER_ID),
  ]);

  return (
    allowedUserIds.has(user.id) ||
    (!!user.email && allowedEmails.has(user.email))
  );
}

export async function resolveAdminAccessForUser(user: { id: string; email: string | null }) {
  const mainAdmin = isMainAdminByEnv(user);
  if (mainAdmin) {
    return {
      isAdmin: true,
      isMainAdmin: true,
      isSubAdmin: false,
      permissions: [...ADMIN_PERMISSIONS],
    } satisfies AdminAccess;
  }

  const sub = await prisma.subAdmin.findUnique({
    where: { userId: user.id },
    select: { id: true, isActive: true, permissions: true },
  });

  if (!sub || !sub.isActive) return null;

  return {
    isAdmin: true,
    isMainAdmin: false,
    isSubAdmin: true,
    permissions: normalizePermissions(sub.permissions),
    subAdminId: sub.id,
  } satisfies AdminAccess;
}

export function hasAdminPermission(access: AdminAccess, permission: AdminPermission) {
  if (access.isMainAdmin) return true;
  return access.permissions.includes(permission);
}

function getRoutePermission(pathname: string): AdminPermission | null {
  if (pathname.startsWith('/api/admin/sub-admins')) return 'sub_admin_manage';
  if (pathname.startsWith('/api/admin/stats')) return 'dashboard';
  if (pathname.startsWith('/api/admin/users')) return 'users';
  if (pathname.startsWith('/api/admin/tournaments')) return 'tournaments';
  if (pathname.startsWith('/api/admin/transactions')) return 'transactions';
  if (pathname.startsWith('/api/admin/payment-qr')) return 'payments';
  if (pathname.startsWith('/api/admin/payouts')) return 'payments';
  if (pathname.startsWith('/api/admin/wallet')) return 'payments';
  if (pathname.startsWith('/api/admin/matches')) return 'custom_management';
  if (pathname.startsWith('/api/admin/custom-odds')) return 'custom_management';
  if (pathname.startsWith('/api/admin/results')) return 'custom_management';
  if (pathname.startsWith('/api/admin/disputes')) return 'custom_management';
  if (pathname.startsWith('/api/admin/notifications')) return 'notifications';
  if (pathname.startsWith('/api/admin/rewards')) return 'gifts';
  if (pathname.startsWith('/api/admin/settings')) return 'settings';
  if (pathname.startsWith('/api/v1/admin/matches')) return 'custom_management';
  if (pathname.startsWith('/api/v1/admin/wallet/reports')) return 'wallet_reports';
  if (pathname.startsWith('/api/v1/admin/reports/custom-matches')) return 'match_reports';
  return null;
}

export function ensureRouteAdminPermission(req: NextRequest, access: AdminAccess) {
  const required = getRoutePermission(req.nextUrl.pathname);
  if (!required) return null;
  if (hasAdminPermission(access, required)) return null;
  return {
    error: `Permission denied: ${required}`,
    status: 403 as const,
  };
}
