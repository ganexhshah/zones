import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cloudinary } from '@/lib/cloudinary';
import { requireAuthUser } from '@/lib/route-auth';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const formData = await req.formData();
    const file = formData.get('avatar') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!file.type?.startsWith('image/')) {
      return NextResponse.json({ error: 'Avatar must be an image file' }, { status: 400 });
    }
    const maxAvatarSize = 5 * 1024 * 1024;
    if (file.size > maxAvatarSize) {
      return NextResponse.json({ error: 'Avatar must be 5MB or smaller' }, { status: 400 });
    }

    // Convert file to base64
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString('base64');
    const dataURI = `data:${file.type};base64,${base64}`;

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(dataURI, {
      folder: 'avatars',
      transformation: [
        { width: 400, height: 400, crop: 'fill', gravity: 'face' },
      ],
    });

    // Update user avatar
    const user = await prisma.user.update({
      where: { id: auth.user.id },
      data: { avatar: result.secure_url },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
      },
    });

    return NextResponse.json({ user, avatarUrl: result.secure_url });
  } catch (error) {
    console.error('Avatar upload error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
