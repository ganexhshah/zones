import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const method = searchParams.get('method');

    if (!method) {
      return NextResponse.json({ error: 'Method is required' }, { status: 400 });
    }

    const normalizedMethod = method.trim().toLowerCase();

    const qrData = await prisma.paymentQR.findFirst({
      where: {
        method: {
          equals: normalizedMethod,
          mode: 'insensitive',
        },
        isActive: true,
      },
    });

    if (!qrData?.qrImage) {
      return NextResponse.json({ error: 'QR image not found' }, { status: 404 });
    }

    const upstream = await fetch(qrData.qrImage, { cache: 'no-store' });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Failed to load QR image from source (${upstream.status})` },
        { status: 502 }
      );
    }

    const contentType = upstream.headers.get('content-type') || 'image/png';
    const bytes = await upstream.arrayBuffer();

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error) {
    console.error('QR image proxy error:', error);
    return NextResponse.json({ error: 'Failed to proxy QR image' }, { status: 500 });
  }
}
