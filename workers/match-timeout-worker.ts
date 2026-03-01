import { expirePendingMatches } from '@/lib/match-v1/service';

const intervalMs = Number(process.env.MATCH_TIMEOUT_WORKER_INTERVAL_MS ?? 30000);

async function tick() {
  try {
    const expired = await expirePendingMatches(new Date());
    if (expired > 0) {
      console.log(`[match-timeout-worker] expired ${expired} pending matches`);
    }
  } catch (error) {
    console.error('[match-timeout-worker] error', error);
  }
}

console.log(`[match-timeout-worker] started, interval=${intervalMs}ms`);
void tick();
setInterval(() => {
  void tick();
}, intervalMs);
