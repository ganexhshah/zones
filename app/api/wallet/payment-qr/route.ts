import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const requestUrl = new URL(req.url);
    const { searchParams } = requestUrl;
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
      },
    });

    if (!qrData || !qrData.isActive) {
      return NextResponse.json({ error: 'Payment method not available' }, { status: 404 });
    }

    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? requestUrl.host;
    const protocol =
      req.headers.get('x-forwarded-proto') ?? requestUrl.protocol.replace(':', '');
    const proxyQrUrl = `${protocol}://${host}/api/wallet/payment-qr/image?method=${encodeURIComponent(
      qrData.method
    )}`;

    return NextResponse.json(
      {
        qrData: {
          id: qrData.id,
          method: qrData.method,
          qrImageUrl: proxyQrUrl,
          qrImage: qrData.qrImage, // Original source URL kept for compatibility/debugging
          qrImageSourceUrl: qrData.qrImage,
          accountName: qrData.accountName,
          accountNumber: qrData.accountNumber,
          isActive: qrData.isActive,
        },
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (error) {
    console.error('Get QR error:', error);
    return NextResponse.json({ error: 'Failed to fetch QR code' }, { status: 500 });
  }
}
