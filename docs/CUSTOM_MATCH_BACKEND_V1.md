# Custom Match Backend v1

This module is implemented under `/api/v1/*` in the Next.js backend and is designed for the 1v1 creator/joiner flow.

## SQL / Prisma Notes

- PostgreSQL provider via Prisma.
- New enums:
  - `MatchStatus`: `OPEN | PENDING_APPROVAL | CONFIRMED | COMPLETED | CANCELLED | EXPIRED`
  - `JoinRequestStatus`: `PENDING | ACCEPTED | REJECTED | EXPIRED`
  - `EscrowStatus`: `LOCKED | RELEASED | REFUNDED`
  - `WalletLedgerType`: `LOCK | UNLOCK | DEBIT | CREDIT | REFUND | WIN | FEE`
- New tables/models:
  - `Match`
  - `JoinRequest`
  - `Escrow`
  - `WalletLedger` (immutable)
  - `MatchLog`
  - `ChatMessage`
  - `FraudFlag`
  - `RefreshToken`
- User wallet split fields added:
  - `User.availableBalance DECIMAL(18,2)`
  - `User.lockedBalance DECIMAL(18,2)`

### Required indexes included

- `Match(status, createdAt)`
- `JoinRequest(matchId, status)`
- `WalletLedger(userId, createdAt)`
- `ChatMessage(matchId, createdAt)`

## API Routes (v1)

Base prefix: `/api/v1`

### Auth

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`

Example `POST /auth/register` request:

```json
{
  "email": "creator@example.com",
  "password": "StrongPass123",
  "name": "Creator"
}
```

Example response:

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "user": {
    "id": "clx...",
    "email": "creator@example.com",
    "phone": null,
    "name": "Creator"
  }
}
```

### Matches

- `POST /matches` (creator creates + lock entry fee)
- `GET /matches?status=OPEN&limit=20`
- `GET /matches/:id`
- `POST /matches/:id/join`
- `POST /matches/:id/cancel`
- `POST /matches/:id/accept`
- `POST /matches/:id/reject`
- `POST /matches/:id/room`
- `POST /matches/:id/result`
- `GET /matches/:id/ledger`

Example `POST /matches`:

```json
{
  "entryFee": 50,
  "gameName": "Free Fire",
  "matchType": "1v1",
  "platformFeePercent": 5
}
```

Example `POST /matches/:id/join` response:

```json
{
  "matchId": "3bf7...",
  "status": "PENDING_APPROVAL",
  "joinRequestStatus": "PENDING",
  "expiresAt": "2026-03-01T10:55:00.000Z"
}
```

Example `POST /matches/:id/accept` response:

```json
{
  "matchId": "3bf7...",
  "status": "CONFIRMED",
  "joinRequestStatus": "ACCEPTED"
}
```

Example `POST /matches/:id/room` request:

```json
{
  "roomId": "FF443221",
  "roomPassword": "8819"
}
```

Example `POST /matches/:id/result` request:

```json
{
  "winnerUserId": "clx_joiner",
  "note": "Result submitted for verification"
}
```

### Wallet

- `GET /wallet`
- `GET /wallet/ledger?limit=50`

`GET /wallet` response:

```json
{
  "available_balance": 1240,
  "locked_balance": 80,
  "transactions": [
    {
      "id": "...",
      "type": "LOCK",
      "match_id": "...",
      "amount": 80,
      "balance_after": 1240,
      "created_at": "2026-03-01T10:41:22.000Z"
    }
  ]
}
```

### Chat

- `GET /matches/:id/chat?cursor=...&limit=30`
- `POST /matches/:id/chat`

`POST /matches/:id/chat` request:

```json
{
  "message": "Room ready?"
}
```

### Admin

- `POST /admin/matches/:id/verify`

Request:

```json
{
  "winnerUserId": "clx_joiner",
  "platformFeePercent": 5
}
```

Response:

```json
{
  "matchId": "3bf7...",
  "status": "COMPLETED",
  "winnerUserId": "clx_joiner"
}
```

## Business Logic Coverage

- Create match: locks creator funds atomically (`LOCK` ledger).
- Join match: uses Redis lock per match + SQL transaction + row locks.
- Accept: confirms pending request + creates escrow `LOCKED`.
- Reject: refunds joiner and returns match to `OPEN`.
- Timeout worker: expires pending requests and refunds joiner.
- Room submit: AES-256-GCM encryption at rest.
- Completion verify: releases escrow, computes fee, writes WIN/FEE/DEBIT ledger, sets match `COMPLETED`.

## Worker

- `workers/match-timeout-worker.ts`
- Run with:
  - `npm run worker:match-timeout`
- Poll interval (default 30s) via:
  - `MATCH_TIMEOUT_WORKER_INTERVAL_MS`

## Realtime (Socket.IO)

Implemented emitter and socket server integration points:

- `lib/match-v1/realtime.ts`
- `server/socket-server.ts`

Run socket-enabled server:

- `npm run dev:socket`

Rooms used:

- `user:{userId}`
- `match:{matchId}`

Events emitted:

- `match.created`
- `match.requested`
- `match.accepted`
- `match.rejected`
- `match.expired`
- `match.room_ready`
- `match.completed`
- `wallet.updated`
- `chat.message`

Example payload shape (`match.requested`):

```json
{
  "matchId": "3bf7...",
  "status": "PENDING_APPROVAL",
  "joinRequest": {
    "id": "4c2d...",
    "status": "PENDING"
  },
  "expiresAt": "2026-03-01T10:55:00.000Z"
}
```

Example payload shape (`chat.message`):

```json
{
  "matchId": "3bf7...",
  "message": {
    "id": "...",
    "senderId": "clx_joiner",
    "message": "gg",
    "createdAt": "2026-03-01T10:53:00.000Z"
  }
}
```

## Security

- Zod validation on all new v1 inputs.
- Rate limiting for auth/login/join/chat routes.
- Action audit in `MatchLog`.
- Room credentials encrypted (AES-256-GCM) via `ROOM_CREDENTIALS_KEY` env.
- Prevents self join.
- Basic fraud flag on repeated join patterns by IP.
- CORS + security headers in `middleware.ts` for `/api/v1/*`.

## Required ENV

- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `ROOM_CREDENTIALS_KEY` (64 hex chars)
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `CORS_ORIGIN` (optional, csv)
