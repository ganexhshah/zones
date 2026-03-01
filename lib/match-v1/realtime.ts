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

export function setSocketServer(server: IOServer) {
  io = server;
}

export function emitToUser(userId: string, event: MatchEventName, payload: unknown) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

export function emitToMatch(matchId: string, event: MatchEventName, payload: unknown) {
  if (!io) return;
  io.to(`match:${matchId}`).emit(event, payload);
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
