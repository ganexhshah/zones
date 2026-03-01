import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { getSystemSettings, saveSystemSettings } from '@/lib/system-settings';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const settings = await getSystemSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('Admin settings GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await requireAdminUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => ({}));
    const minDepositAmount = Number(body.minDepositAmount);
    const minWithdrawalAmount = Number(body.minWithdrawalAmount);
    const autoApprovePayments = Boolean(body.autoApprovePayments);

    if (!Number.isFinite(minDepositAmount) || minDepositAmount <= 0) {
      return NextResponse.json({ error: 'Invalid minimum deposit amount' }, { status: 400 });
    }
    if (!Number.isFinite(minWithdrawalAmount) || minWithdrawalAmount <= 0) {
      return NextResponse.json({ error: 'Invalid minimum withdrawal amount' }, { status: 400 });
    }

    const settings = await saveSystemSettings({
      minDepositAmount,
      minWithdrawalAmount,
      autoApprovePayments,
    });

    return NextResponse.json({ settings });
  } catch (error) {
    console.error('Admin settings PUT error:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
