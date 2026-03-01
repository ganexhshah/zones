import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ROOM_CREDENTIALS_KEY || '';

function getKey(): Buffer {
  if (ENCRYPTION_KEY && ENCRYPTION_KEY.length === 64) {
    return Buffer.from(ENCRYPTION_KEY, 'hex');
  }

  // Backward-compatible fallback: derive 32-byte key from existing app secret.
  // Prefer explicit ROOM_CREDENTIALS_KEY in production.
  const secret =
    process.env.JWT_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    '';

  if (!secret) {
    throw new Error(
      'ROOM_CREDENTIALS_KEY missing. Set 64 hex chars or configure JWT/NEXTAUTH/AUTH secret.',
    );
  }

  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptText(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const key = getKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptText(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted payload format');
  }

  const key = getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
