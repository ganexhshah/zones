import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cloudinary } from '@/lib/cloudinary';
import { verifyToken } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { getSystemSettings } from '@/lib/system-settings';
import { sendPushToUser } from '@/lib/push';

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

    const settings = await getSystemSettings();
    if (amount < settings.minDepositAmount) {
      return NextResponse.json(
        { error: `Minimum deposit is Rs ${settings.minDepositAmount.toFixed(0)}` },
        { status: 400 }
      );
    }

    const bytes = await screenshot.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString('base64');
    const dataURI = `data:${screenshot.type};base64,${base64}`;

    const uploadResult = await cloudinary.uploader.upload(dataURI, {
      folder: 'payment_screenshots',
    });

    const transaction = await prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          userId: payload.userId,
          type: 'deposit',
          amount,
          method,
          status: settings.autoApprovePayments ? 'completed' : 'pending',
          screenshot: uploadResult.secure_url,
        },
      });

      if (settings.autoApprovePayments) {
        await tx.user.update({
          where: { id: payload.userId },
          data: {
            walletBalance: {
              increment: amount,
            },
          },
        });
      }

      return created;
    });

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { email: true, name: true },
    });

    if (user?.email) {
      await sendEmail(
        user.email,
        settings.autoApprovePayments ? 'Payment Approved' : 'Payment Verification Pending',
        `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>${settings.autoApprovePayments ? 'Payment Approved' : 'Payment Submitted Successfully'}</h2>
            <p>Hi ${user.name || 'User'},</p>
            <p>${
              settings.autoApprovePayments
                ? 'Your payment has been automatically approved and added to your wallet.'
                : 'Your payment request has been submitted and is pending verification.'
            }</p>
            <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p><strong>Amount:</strong> Rs ${amount}</p>
              <p><strong>Method:</strong> ${method}</p>
              <p><strong>Status:</strong> ${settings.autoApprovePayments ? 'Completed' : 'Pending Verification'}</p>
              <p><strong>Transaction ID:</strong> ${transaction.id}</p>
            </div>
            ${
              settings.autoApprovePayments
                ? '<p>You can start using your updated balance immediately.</p>'
                : '<p>We will verify your payment within 24 hours and update your wallet balance.</p><p>You will receive another email once the payment is verified.</p>'
            }
          </div>
        `
      );
    }

    await sendPushToUser(payload.userId, {
      title: settings.autoApprovePayments ? 'Deposit Approved' : 'Deposit Submitted',
      body: settings.autoApprovePayments
        ? `Rs ${amount.toFixed(2)} added to your wallet.`
        : `Your deposit of Rs ${amount.toFixed(2)} is under review.`,
      data: {
        type: 'deposit',
        status: settings.autoApprovePayments ? 'completed' : 'pending',
        transactionId: transaction.id,
      },
    });

    return NextResponse.json({
      transaction,
      message: settings.autoApprovePayments
        ? 'Payment approved and wallet updated successfully.'
        : 'Payment submitted successfully. Verification pending.',
    });
  } catch (error) {
    console.error('Deposit error:', error);
    return NextResponse.json({ error: 'Failed to process deposit' }, { status: 500 });
  }
}
