import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';
import { cloudinary } from '@/lib/cloudinary';

const MAX_QR_IMAGE_BYTES = 5 * 1024 * 1024;

// Get all payment QR codes
export async function GET(req: NextRequest) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const qrCodes = await prisma.paymentQR.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ qrCodes });
  } catch (error) {
    console.error('Get QR codes error:', error);
    return NextResponse.json({ error: 'Failed to fetch QR codes' }, { status: 500 });
  }
}

// Upload or update payment QR code
export async function POST(req: NextRequest) {
  try {
    const adminAuth = await requireAdminUser(req);
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status });
    }
    const formData = await req.formData();
    const method = (formData.get('method') as string)?.trim().toLowerCase();
    const qrImage = formData.get('qrImage') as File;
    const accountName = formData.get('accountName') as string;
    const accountNumber = formData.get('accountNumber') as string;

    if (!method || !qrImage) {
      return NextResponse.json({ error: 'Method and QR image are required' }, { status: 400 });
    }
    if (!qrImage.type?.startsWith('image/')) {
      return NextResponse.json({ error: 'QR must be an image file' }, { status: 400 });
    }
    if (qrImage.size > MAX_QR_IMAGE_BYTES) {
      return NextResponse.json({ error: 'QR image must be 5MB or smaller' }, { status: 400 });
    }

    // Upload QR code to Cloudinary
    const bytes = await qrImage.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString('base64');
    const dataURI = `data:${qrImage.type};base64,${base64}`;

    const uploadResult = await cloudinary.uploader.upload(dataURI, {
      folder: 'payment_qr_codes',
      format: 'png', // Force PNG format for better compatibility
      quality: 'auto:best',
    });

    // Create or update QR data
    const qrData = await prisma.paymentQR.upsert({
      where: { method },
      update: {
        qrImage: uploadResult.secure_url,
        accountName,
        accountNumber,
      },
      create: {
        method,
        qrImage: uploadResult.secure_url,
        accountName,
        accountNumber,
      },
    });

    return NextResponse.json({ qrData });
  } catch (error) {
    console.error('Upload QR error:', error);
    return NextResponse.json({ error: 'Failed to upload QR code' }, { status: 500 });
  }
}
