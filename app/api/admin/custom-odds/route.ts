import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { getCustomMatchOdds, saveCustomMatchOdds } from '@/lib/custom-odds';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const odds = await getCustomMatchOdds();
    return NextResponse.json({ odds });
  } catch (error) {
    console.error('Admin custom odds GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch custom odds' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await requireAdminUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = {
      '1v1': Number(body?.['1v1']),
      '2v2': Number(body?.['2v2']),
      '3v3': Number(body?.['3v3']),
      '4v4': Number(body?.['4v4']),
    };

    const allValues = Object.values(parsed);
    if (allValues.some((value) => !Number.isFinite(value) || value < 1 || value > 2)) {
      return NextResponse.json({ error: 'Each odd must be between 1.0 and 2.0' }, { status: 400 });
    }

    const odds = await saveCustomMatchOdds(parsed);
    return NextResponse.json({ odds });
  } catch (error) {
    console.error('Admin custom odds PUT error:', error);
    return NextResponse.json({ error: 'Failed to save custom odds' }, { status: 500 });
  }
}
