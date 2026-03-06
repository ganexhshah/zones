import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { hashPassword, generateOTP } from '@/lib/auth';
import { sendOTP } from '@/lib/email';
import { rateLimit } from '@/lib/match-v1/redis-guards';

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'anon';
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    const phone = String(body?.phone || '').trim() || null;
    const name = String(body?.name || '').trim() || null;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const ipLimiter = await rateLimit(`rl:auth:signup:ip:${ip}`, 10, 60);
    if (!ipLimiter.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
    const emailLimiter = await rateLimit(`rl:auth:signup:email:${email}`, 5, 600);
    if (!emailLimiter.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const existing = await prisma.user.findFirst({
      where: { 
        OR: [
          { email },
          { phone: phone ? phone : undefined },
        ] 
      },
    });

    if (existing?.isVerified) {
      // Do not reveal account existence details.
      return NextResponse.json({ message: 'If eligible, OTP has been sent to email' });
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
      message: 'If eligible, OTP has been sent to email',
    });
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json({ error: 'Signup failed' }, { status: 500 });
  }
}
