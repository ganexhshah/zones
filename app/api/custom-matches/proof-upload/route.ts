import { NextRequest, NextResponse } from 'next/server';
import { cloudinary } from '@/lib/cloudinary';
import { requireAuthPayload } from '@/lib/route-auth';

export async function POST(req: NextRequest) {
  try {
    const auth = requireAuthPayload(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const formData = await req.formData();
    const screenshot = formData.get('screenshot') as File | null;
    if (!screenshot) {
      return NextResponse.json({ error: 'screenshot is required' }, { status: 400 });
    }

    const bytes = await screenshot.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString('base64');
    const dataURI = `data:${screenshot.type};base64,${base64}`;

    const uploadResult = await cloudinary.uploader.upload(dataURI, {
      folder: 'custom_match_proofs',
    });

    return NextResponse.json({ proofUrl: uploadResult.secure_url });
  } catch (error) {
    console.error('Custom proof upload error:', error);
    return NextResponse.json({ error: 'Failed to upload proof image' }, { status: 500 });
  }
}
