import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, ''),
  },
});

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildBrandedEmailHtml(subject: string, contentHtml: string) {
  const appName = process.env.EMAIL_APP_NAME || 'CrackZones';
  const supportEmail = process.env.EMAIL_SUPPORT_EMAIL || process.env.GMAIL_USER || 'support@crackzones.com';
  const logoUrl = process.env.EMAIL_LOGO_URL || 'https://crackzones.com/logo.png';
  const safeSubject = escapeHtml(subject);
  const currentYear = new Date().getFullYear();

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${safeSubject}</title>
      </head>
      <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
                <tr>
                  <td style="background:linear-gradient(135deg,#111827,#1f2937);padding:20px 24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="vertical-align:middle;">
                          <img src="${logoUrl}" alt="${appName} Logo" width="42" height="42" style="display:block;border-radius:10px;background:#ffffff;padding:4px;border:0;outline:none;text-decoration:none;" />
                        </td>
                        <td style="vertical-align:middle;padding-left:12px;">
                          <div style="color:#f9fafb;font-size:20px;font-weight:700;line-height:1.2;">${appName}</div>
                          <div style="color:#d1d5db;font-size:12px;line-height:1.2;">Trusted Gaming Platform</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:26px 24px 10px 24px;">
                    <h1 style="margin:0 0 8px 0;font-size:21px;line-height:1.35;color:#111827;">${safeSubject}</h1>
                    <div style="height:1px;background:#e5e7eb;margin:14px 0 16px 0;"></div>
                    <div style="font-size:14px;line-height:1.65;color:#374151;">
                      ${contentHtml}
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 24px 24px 24px;">
                    <div style="margin-top:14px;padding:12px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;font-size:12px;line-height:1.6;color:#6b7280;">
                      Need help? Contact us at <a href="mailto:${supportEmail}" style="color:#111827;text-decoration:none;font-weight:600;">${supportEmail}</a>.
                    </div>
                    <p style="margin:14px 0 0 0;font-size:11px;color:#9ca3af;text-align:center;">
                      © ${currentYear} ${appName}. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

export async function sendEmail(to: string, subject: string, html: string) {
  try {
    const styledHtml = buildBrandedEmailHtml(subject, html);
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to,
      subject,
      html: styledHtml,
    });
    return { success: true };
  } catch (error) {
    console.error('Email error:', error);
    return { success: false, error };
  }
}

function parseCsvEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function getAdminEmailRecipients() {
  const values = [
    ...parseCsvEnv(process.env.ADMIN_EMAILS),
    ...parseCsvEnv(process.env.ADMIN_EMAIL),
  ];
  return Array.from(new Set(values));
}

export async function sendEmailMany(
  toList: string[],
  subject: string,
  html: string,
) {
  const valid = Array.from(new Set(toList.map((e) => e.trim()).filter(Boolean)));
  if (valid.length == 0) return { success: true };
  try {
    const styledHtml = buildBrandedEmailHtml(subject, html);
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: valid.join(','),
      subject,
      html: styledHtml,
    });
    return { success: true };
  } catch (error) {
    console.error('Bulk email error:', error);
    return { success: false, error };
  }
}

export async function sendOTP(email: string, otp: string) {
  const html = `
    <p style="margin:0 0 10px 0;">Use the verification code below to continue:</p>
    <div style="margin:10px 0 14px 0;padding:14px 16px;border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;text-align:center;">
      <span style="display:inline-block;font-size:34px;line-height:1;font-weight:700;color:#111827;letter-spacing:8px;">${otp}</span>
    </div>
    <p style="margin:0;color:#4b5563;">This code expires in <strong>10 minutes</strong>. If you did not request this, you can ignore this email.</p>
  `;
  return sendEmail(email, 'Your OTP Code', html);
}
