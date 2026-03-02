import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
const JWT_SECRET = requireEnv('JWT_SECRET');

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function generateToken(userId: string) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

export function verifyToken(token: string) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (
      decoded &&
      typeof decoded === 'object' &&
      'userId' in decoded &&
      typeof (decoded as { userId?: unknown }).userId === 'string'
    ) {
      return { userId: (decoded as { userId: string }).userId };
    }
    return null;
  } catch {
    return null;
  }
}

export function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
