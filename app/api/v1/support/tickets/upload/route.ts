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
    const attachment = formData.get('attachment') as File | null;
    if (!attachment) {
      return NextResponse.json({ error: 'Attachment image is required' }, { status: 400 });
    }

    const bytes = await attachment.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString('base64');
    const dataURI = `data:${attachment.type};base64,${base64}`;

    const uploadResult = await cloudinary.uploader.upload(dataURI, {
      folder: 'support_tickets',
    });

    return NextResponse.json({ imageUrl: uploadResult.secure_url });
  } catch (error) {
    console.error('support ticket image upload error:', error);
    return NextResponse.json({ error: 'Failed to upload attachment image' }, { status: 500 });
  }
}
