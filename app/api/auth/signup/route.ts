import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { hashPassword, generateOTP } from '@/lib/auth';
import { sendOTP } from '@/lib/email';

export async function POST(req: NextRequest) {
  try {
    const { email, password, phone, name } = await req.json();

    const existing = await prisma.user.findFirst({
      where: { 
        OR: [
          { email },
          { phone: phone ? phone : undefined }
        ] 
      },
    });

    if (existing) {
      // If user exists and is verified, they should login instead
      if (existing.isVerified) {
        return NextResponse.json(
          { error: 'Account already exists. Please login instead.' },
          { status: 400 }
        );
      }
    }

    const otp = generateOTP();

    await redis.setex(`otp:${email}`, 600, otp);

    await sendOTP(email, otp);

    const hashedPassword = await hashPassword(password);
    await redis.setex(
      `signup:${email}`,
      600,
      JSON.stringify({ email, password: hashedPassword, phone, name })
    );

    return NextResponse.json({ 
      message: 'OTP sent to email',
      isResend: existing && !existing.isVerified 
    });
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json({ error: 'Signup failed' }, { status: 500 });
  }
}
