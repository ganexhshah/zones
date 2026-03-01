import { NextRequest, NextResponse } from 'next/server';

import { requireAuthUser } from '@/lib/route-auth';
import { cloudinary } from '@/lib/cloudinary';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error ?? 'Unauthorized' }, { status: auth.status });
    }

    const formData = await req.formData();
    const screenshot = formData.get('screenshot') as File | null;
    if (!screenshot) {
      return NextResponse.json({ error: 'Proof screenshot is required' }, { status: 400 });
    }

    const bytes = await screenshot.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString('base64');
    const dataURI = `data:${screenshot.type};base64,${base64}`;

    const uploadResult = await cloudinary.uploader.upload(dataURI, {
      folder: 'custom_match_proofs',
    });

    return NextResponse.json({
      proofUrl: uploadResult.secure_url,
    });
  } catch (error) {
    console.error('v1 proof upload error:', error);
    return NextResponse.json({ error: 'Failed to upload proof image' }, { status: 500 });
  }
}

