import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { generateToken } from '@/lib/auth';
import { resolveAccountRestriction } from '@/lib/account-status';
import { rateLimit } from '@/lib/match-v1/redis-guards';

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'anon';
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || '').trim().toLowerCase();
    const otp = String(body?.otp || '').trim();

    if (!email || !otp) {
      return NextResponse.json({ error: 'Invalid OTP' }, { status: 400 });
    }

    const ipLimiter = await rateLimit(`rl:auth:verify-otp:ip:${ip}`, 20, 60);
    if (!ipLimiter.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
    const emailLimiter = await rateLimit(`rl:auth:verify-otp:email:${email}`, 10, 600);
    if (!emailLimiter.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const storedOTP = await redis.get(`otp:${email}`);

    if (!storedOTP) {
      return NextResponse.json({ error: 'Invalid OTP' }, { status: 400 });
    }
    
    // Convert both to strings for comparison
    const otpString = otp;
    const storedOTPString = String(storedOTP).trim();

    if (storedOTPString !== otpString) {
      return NextResponse.json({ error: 'Invalid OTP' }, { status: 400 });
    }

    const signupData = await redis.get(`signup:${email}`);

    if (!signupData) {
      return NextResponse.json({ error: 'Invalid OTP' }, { status: 400 });
    }

    // Handle both string and object responses from Redis
    let userData;
    if (typeof signupData === 'string') {
      userData = JSON.parse(signupData);
    } else {
      userData = signupData;
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });
    
    let user;
    if (existingUser) {
      user = await prisma.user.update({
        where: { id: existingUser.id },
        data: { 
          isVerified: true,
          password: userData.password,
          passwordHash: userData.password,
          name: userData.name || existingUser.name,
          phone: userData.phone || existingUser.phone,
        },
      });
    } else {
      user = await prisma.user.create({
        data: { ...userData, passwordHash: userData.password, isVerified: true },
      });
    }

    await redis.del(`otp:${email}`, `signup:${email}`);

    const restriction = await resolveAccountRestriction(user);
    if (restriction) {
      return NextResponse.json(
        {
          error:
            restriction.status === 'SUSPENDED'
              ? 'Account suspended'
              : 'Account blocked',
          accountStatus: restriction,
        },
        { status: 403 },
      );
    }

    const token = generateToken(user.id);
    return NextResponse.json({ token, user: { id: user.id, email: user.email } });
  } catch (error) {
    console.error('OTP verification error:', error);
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
