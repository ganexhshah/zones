import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400, meta?: unknown) {
  return NextResponse.json({ error: message, ...(meta ? { meta } : {}) }, { status });
}

export function handleApiError(error: unknown) {
  const maybeDigest =
    error && typeof error === 'object' && 'digest' in error
      ? (error as { digest?: unknown }).digest
      : undefined;
  if (maybeDigest !== 'DYNAMIC_SERVER_USAGE') {
    console.error('Match v1 API error:', error);
  }

  if (error instanceof ZodError) {
    return fail('Validation failed', 400, error.flatten());
  }
  if (error instanceof Error) {
    switch (error.message) {
      case 'INSUFFICIENT_BALANCE':
        return fail('Insufficient balance', 409);
      case 'entryFee must be a positive number':
        return fail('Entry fee must be greater than 0', 400);
      case 'MATCH_NOT_OPEN':
      case 'INVALID_STATUS':
      case 'CHAT_DISABLED':
        return fail('Invalid match status for requested action', 409);
      case 'SELF_JOIN_NOT_ALLOWED':
        return fail('You cannot join your own match', 400);
      case 'ALREADY_REQUESTED':
        return fail('Join request already pending', 409);
      case 'FORBIDDEN':
        return fail('Forbidden', 403);
      case 'NOT_FOUND':
      case 'NO_JOINER':
      case 'NO_PENDING_REQUEST':
      case 'ESCROW_NOT_FOUND':
        return fail('Not found', 404);
      case 'INVALID_WINNER':
        return fail('Invalid winner for this match', 400);
      case 'ROOM_CREDENTIALS_KEY missing. Set 64 hex chars or configure JWT/NEXTAUTH/AUTH secret.':
        return fail('Room encryption is not configured on server', 500);
      default:
        return fail('Internal server error', 500);
    }
  }
  return fail('Internal server error', 500);
}
