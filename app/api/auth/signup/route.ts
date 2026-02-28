import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { hashPassword, generateOTP } from '@/lib/auth';
import { sendOTP } from '@/lib/email';

export async function POST(req: NextRequest) {
  try {
    const { email, password, phone, name } = await req.json();
    
    console.log('Signup request for:', email, 'Name:', name);

    const existing = await prisma.user.findFirst({
      where: { 
        OR: [
          { email },
          { phone: phone ? phone : undefined }
        ] 
      },
    });

    if (existing) {
      console.log('User already exists:', email);
      
      // If user exists and is verified, they should login instead
      if (existing.isVerified) {
        return NextResponse.json(
          { error: 'Account already exists. Please login instead.' },
          { status: 400 }
        );
      }
      
      // If user exists but not verified, allow resending OTP
      console.log('User exists but not verified, resending OTP');
    }

    const otp = generateOTP();
    console.log('Generated OTP for', email, ':', otp);
    
    await redis.setex(`otp:${email}`, 600, otp);
    console.log('Stored OTP in Redis with key:', `otp:${email}`);

    const emailResult = await sendOTP(email, otp);
    console.log('Email send result:', emailResult);

    const hashedPassword = await hashPassword(password);
    await redis.setex(
      `signup:${email}`,
      600,
      JSON.stringify({ email, password: hashedPassword, phone, name })
    );
    
    console.log('Signup data stored in Redis');

    return NextResponse.json({ 
      message: 'OTP sent to email',
      isResend: existing && !existing.isVerified 
    });
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json({ error: 'Signup failed' }, { status: 500 });
  }
}
