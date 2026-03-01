import http from 'http';
import next from 'next';
import { Server as IOServer } from 'socket.io';

import { verifyToken } from '@/lib/auth';
import { setSocketServer } from '@/lib/match-v1/realtime';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3001);

const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

void app.prepare().then(() => {
  const httpServer = http.createServer((req, res) => {
    void handler(req, res);
  });

  const io = new IOServer(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',').map((v) => v.trim()) ?? '*',
      credentials: true,
    },
  });

  setSocketServer(io);

  io.on('connection', (socket) => {
    const token = (socket.handshake.auth?.token ?? socket.handshake.query?.token) as string | undefined;
    let userId: string | null = null;
    if (token) {
      const parsed = verifyToken(token.replace('Bearer ', ''));
      if (parsed?.userId) {
        userId = parsed.userId;
        socket.data.userId = parsed.userId;
        socket.join(`user:${parsed.userId}`);
      }
    }

    socket.on('match:subscribe', (payload: { matchId?: string }) => {
      if (!payload?.matchId) return;
      socket.join(`match:${payload.matchId}`);
    });

    socket.on('match:unsubscribe', (payload: { matchId?: string }) => {
      if (!payload?.matchId) return;
      socket.leave(`match:${payload.matchId}`);
    });

    socket.on(
      'chat:typing',
      (payload: { matchId?: string; isTyping?: boolean }) => {
        if (!payload?.matchId || !userId) return;
        io.to(`match:${payload.matchId}`).emit('chat.typing', {
          matchId: payload.matchId,
          userId,
          isTyping: payload.isTyping == true,
        });
      },
    );
  });

  httpServer.listen(port, hostname, () => {
    console.log(`> Socket server ready on http://${hostname}:${port}`);
  });
});
