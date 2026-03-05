import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://crackzone-472dd.web.app',
  'https://crackzones.xyz',
  'https://www.crackzones.xyz',
  'https://cash.crackzones.xyz',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8081',
  'http://127.0.0.1:8081',
];

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function getAllowedOrigins() {
  const raw = process.env.CORS_ORIGIN;
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  const parsed = raw
    .split(',')
    .map((v) => normalizeOrigin(v))
    .filter(Boolean);
  return parsed.length ? parsed : DEFAULT_ALLOWED_ORIGINS;
}

export function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  const originHeader = req.headers.get('origin');
  const origin = originHeader ? normalizeOrigin(originHeader) : '';
  const allowedOrigins = getAllowedOrigins();
  const isAllowed = origin && (allowedOrigins.includes('*') || allowedOrigins.includes(origin));
  const allowOrigin = isAllowed ? origin : allowedOrigins[0] ?? DEFAULT_ALLOWED_ORIGINS[0];

  response.headers.set('Access-Control-Allow-Origin', allowOrigin);
  response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: response.headers });
  }

  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};
