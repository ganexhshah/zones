import { NextRequest, NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '@/lib/prisma';
import { generateToken } from '@/lib/auth';
import { resolveAccountRestriction } from '@/lib/account-status';

function getAllowedGoogleClientIds() {
  const ids = [
    ...(process.env.GOOGLE_CLIENT_IDS || '').split(','),
    process.env.GOOGLE_CLIENT_ID || '',
  ]
    .map((id) => id.trim())
    .filter(Boolean);

  return Array.from(new Set(ids));
}

export async function POST(req: NextRequest) {
  try {
    const allowedClientIds = getAllowedGoogleClientIds();
    if (allowedClientIds.length === 0) {
      return NextResponse.json({ error: 'Google auth not configured' }, { status: 500 });
    }

    const client = new OAuth2Client(allowedClientIds[0]);
    const { idToken, accessToken } = await req.json();

    let payload:
      | {
          email?: string;
          name?: string;
          picture?: string;
          sub?: string;
        }
      | undefined;

    if (typeof idToken === 'string' && idToken.trim().length > 0) {
      const ticket = await client.verifyIdToken({
        idToken,
        audience: allowedClientIds,
      });
      payload = ticket.getPayload();
    } else if (typeof accessToken === 'string' && accessToken.trim().length > 0) {
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!userInfoRes.ok) {
        return NextResponse.json({ error: 'Invalid Google access token' }, { status: 401 });
      }
      payload = (await userInfoRes.json()) as {
        email?: string;
        name?: string;
        picture?: string;
        sub?: string;
      };
    }

    if (!payload || !payload.email) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    }

    let user = await prisma.user.findUnique({
      where: { email: payload.email },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: payload.email,
          name: payload.name,
          avatar: payload.picture,
          googleId: payload.sub,
          authProvider: 'google',
          isVerified: true,
        },
      });
    } else if (!user.googleId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: payload.sub,
          isVerified: true,
        },
      });
    }

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
    return NextResponse.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (error) {
    console.error('Google auth error:', error);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}
