import { Queue, Worker } from 'bullmq';

import { expirePendingMatches } from '@/lib/match-v1/service';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error('REDIS_URL is required for BullMQ worker');
}

const connection = { url: redisUrl };

const queueName = 'match-timeout-queue';
const queue = new Queue(queueName, { connection });

const worker = new Worker(
  queueName,
  async () => {
    const expired = await expirePendingMatches(new Date());
    if (expired > 0) {
      console.log(`[bullmq] expired ${expired} pending matches`);
    }
    return { expired };
  },
  { connection },
);

worker.on('completed', (job, result) => {
  console.log(`[bullmq] job ${job.id} completed`, result);
});

worker.on('failed', (job, err) => {
  console.error(`[bullmq] job ${job?.id ?? 'unknown'} failed`, err);
});

const everyMs = Number(process.env.MATCH_TIMEOUT_WORKER_INTERVAL_MS ?? 30000);

async function bootstrap() {
  await queue.upsertJobScheduler('pending-match-expiry-scheduler', {
    every: everyMs,
  });

  console.log(`[bullmq] worker running, schedule every ${everyMs}ms`);
}

void bootstrap();
