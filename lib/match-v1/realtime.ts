import { Server as IOServer } from 'socket.io';

type MatchEventName =
  | 'match.created'
  | 'match.requested'
  | 'match.accepted'
  | 'match.rejected'
  | 'match.expired'
  | 'match.room_ready'
  | 'match.completed'
  | 'wallet.updated'
  | 'chat.message';

let io: IOServer | null = null;
const GLOBAL_IO_KEY = '__matchIoServer';

function getSocketServer(): IOServer | null {
  if (io) return io;
  const globalServer = (globalThis as Record<string, unknown>)[GLOBAL_IO_KEY];
  return globalServer instanceof IOServer ? globalServer : null;
}

export function setSocketServer(server: IOServer) {
  io = server;
  (globalThis as Record<string, unknown>)[GLOBAL_IO_KEY] = server;
}

export function emitToUser(userId: string, event: MatchEventName, payload: unknown) {
  const server = getSocketServer();
  if (!server) return;
  server.to(`user:${userId}`).emit(event, payload);
}

export function emitToMatch(matchId: string, event: MatchEventName, payload: unknown) {
  const server = getSocketServer();
  if (!server) return;
  server.to(`match:${matchId}`).emit(event, payload);
}

export function emitMatchAndUsers(params: {
  matchId: string;
  userIds: string[];
  event: MatchEventName;
  payload: unknown;
}) {
  emitToMatch(params.matchId, params.event, params.payload);
  for (const userId of params.userIds) {
    emitToUser(userId, params.event, params.payload);
  }
}
