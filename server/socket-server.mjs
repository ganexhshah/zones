import http from 'http';
import jwt from 'jsonwebtoken';
import next from 'next';
import { Server as IOServer } from 'socket.io';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3001);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error('JWT_SECRET is required');
}

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

  globalThis.__matchIoServer = io;

  io.on('connection', (socket) => {
    const rawToken = socket.handshake.auth?.token ?? socket.handshake.query?.token;
    const token = typeof rawToken === 'string' ? rawToken.replace('Bearer ', '') : '';

    let userId = null;
    if (token) {
      try {
        const parsed = jwt.verify(token, jwtSecret);
        if (parsed && typeof parsed === 'object' && typeof parsed.userId === 'string') {
          userId = parsed.userId;
          socket.data.userId = parsed.userId;
          socket.join(`user:${parsed.userId}`);
        }
      } catch {
        userId = null;
      }
    }

    socket.on('match:subscribe', (payload = {}) => {
      if (!payload.matchId) return;
      socket.join(`match:${payload.matchId}`);
    });

    socket.on('match:unsubscribe', (payload = {}) => {
      if (!payload.matchId) return;
      socket.leave(`match:${payload.matchId}`);
    });

    socket.on('chat:typing', (payload = {}) => {
      if (!payload.matchId || !userId) return;
      io.to(`match:${payload.matchId}`).emit('chat.typing', {
        matchId: payload.matchId,
        userId,
        isTyping: payload.isTyping === true,
      });
    });
  });

  httpServer.listen(port, hostname, () => {
    console.log(`> Socket server ready on http://${hostname}:${port}`);
  });
});
