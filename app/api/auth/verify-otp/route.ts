import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { generateToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { email, otp } = await req.json();
    
    console.log('OTP Verification Request:', { email, otp, otpType: typeof otp });

    const storedOTP = await redis.get(`otp:${email}`);
    console.log('Stored OTP:', { storedOTP, storedType: typeof storedOTP });
    
    if (!storedOTP) {
      console.log('No OTP found in Redis for:', email);
      return NextResponse.json({ error: 'Invalid OTP or OTP expired' }, { status: 400 });
    }
    
    // Convert both to strings for comparison
    const otpString = String(otp).trim();
    const storedOTPString = String(storedOTP).trim();
    
    console.log('Comparing:', { otpString, storedOTPString, match: otpString === storedOTPString });
    
    if (storedOTPString !== otpString) {
      console.log('OTP mismatch!');
      return NextResponse.json({ error: 'Invalid OTP' }, { status: 400 });
    }

    const signupData = await redis.get(`signup:${email}`);
    console.log('Signup data from Redis:', signupData, 'Type:', typeof signupData);
    
    if (!signupData) {
      console.log('No signup data found for:', email);
      return NextResponse.json({ error: 'Session expired' }, { status: 400 });
    }

    // Handle both string and object responses from Redis
    let userData;
    if (typeof signupData === 'string') {
      userData = JSON.parse(signupData);
    } else {
      userData = signupData;
    }
    
    console.log('Parsed user data:', userData);
    
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });
    
    let user;
    if (existingUser) {
      // Update existing user
      console.log('Updating existing user:', email);
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
      // Create new user
      console.log('Creating new user:', email);
      user = await prisma.user.create({
        data: { ...userData, isVerified: true },
      });
    }

    await redis.del(`otp:${email}`, `signup:${email}`);
    
    console.log('OTP verification successful for:', email);

    const token = generateToken(user.id);
    return NextResponse.json({ token, user: { id: user.id, email: user.email } });
  } catch (error) {
    console.error('OTP verification error:', error);
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
