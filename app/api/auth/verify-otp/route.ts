import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { generateToken } from '@/lib/auth';
import { resolveAccountRestriction } from '@/lib/account-status';

export async function POST(req: NextRequest) {
  try {
    const { email, otp } = await req.json();

    const storedOTP = await redis.get(`otp:${email}`);

    if (!storedOTP) {
      return NextResponse.json({ error: 'Invalid OTP or OTP expired' }, { status: 400 });
    }
    
    // Convert both to strings for comparison
    const otpString = String(otp).trim();
    const storedOTPString = String(storedOTP).trim();

    if (storedOTPString !== otpString) {
      return NextResponse.json({ error: 'Invalid OTP' }, { status: 400 });
    }

    const signupData = await redis.get(`signup:${email}`);

    if (!signupData) {
      return NextResponse.json({ error: 'Session expired' }, { status: 400 });
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
          name: userData.name || existingUser.name,
          phone: userData.phone || existingUser.phone,
        },
      });
    } else {
      user = await prisma.user.create({
        data: { ...userData, isVerified: true },
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
