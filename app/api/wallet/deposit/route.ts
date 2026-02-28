import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cloudinary } from '@/lib/cloudinary';
import { verifyToken } from '@/lib/auth';
import { sendEmail } from '@/lib/email';

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const formData = await req.formData();
    const amount = parseFloat(formData.get('amount') as string);
    const method = formData.get('method') as string;
    const screenshot = formData.get('screenshot') as File;

    if (!amount || !method || !screenshot) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }

    if (amount < 10) {
      return NextResponse.json({ error: 'Minimum deposit is ₹10' }, { status: 400 });
    }

    // Upload screenshot to Cloudinary
    const bytes = await screenshot.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString('base64');
    const dataURI = `data:${screenshot.type};base64,${base64}`;

    const uploadResult = await cloudinary.uploader.upload(dataURI, {
      folder: 'payment_screenshots',
    });

    // Create transaction
    const transaction = await prisma.transaction.create({
      data: {
        userId: payload.userId,
        type: 'deposit',
        amount,
        method,
        status: 'pending',
        screenshot: uploadResult.secure_url,
      },
    });

    // Get user details
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { email: true, name: true },
    });

    // Send email notification
    if (user?.email) {
      await sendEmail(
        user.email,
        'Payment Verification Pending',
        `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Payment Submitted Successfully</h2>
            <p>Hi ${user.name || 'User'},</p>
            <p>Your payment request has been submitted and is pending verification.</p>
            <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p><strong>Amount:</strong> ₹${amount}</p>
              <p><strong>Method:</strong> ${method}</p>
              <p><strong>Status:</strong> Pending Verification</p>
              <p><strong>Transaction ID:</strong> ${transaction.id}</p>
            </div>
            <p>We will verify your payment within 24 hours and update your wallet balance.</p>
            <p>You will receive another email once the payment is verified.</p>
          </div>
        `
      );
    }

    return NextResponse.json({ 
      transaction,
      message: 'Payment submitted successfully. Verification pending.' 
    });
  } catch (error) {
    console.error('Deposit error:', error);
    return NextResponse.json({ error: 'Failed to process deposit' }, { status: 500 });
  }
}
