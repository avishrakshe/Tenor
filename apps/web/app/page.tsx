import { Landing, type LiveStats } from '@/components/Landing';
import { view, type Breach, type Funded, type ReserveState } from '@/lib/chain';
import { getRequestConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

const EMPTY: LiveStats = { reserve: null, liveMaxLoss: null, coverage: null, funded: null, breaches: null };

async function readStats(): Promise<LiveStats> {
  const config = await getRequestConfig();
  if (!config.deployed) return EMPTY;
  const tenor = config.stack.tenor;
  try {
    const [reserve, funded, breaches] = await Promise.all([
      view<ReserveState>(config.rpc, tenor, 'reserve_state'),
      view<Funded[]>(config.rpc, tenor, 'list_funded', { from_index: 0, limit: 500 }),
      view<Breach[]>(config.rpc, tenor, 'list_breaches', { from_index: 0, limit: 500 }),
    ]);
    return {
      reserve: Number(BigInt(reserve.reserve) / 1_000_000n),
      liveMaxLoss: Number(BigInt(reserve.live_max_loss) / 1_000_000n),
      coverage: reserve.coverage_bps ? Number(reserve.coverage_bps) / 10_000 : null,
      funded: funded.length,
      breaches: breaches.length,
    };
  } catch {
    return EMPTY;
  }
}

export default async function Home() {
  return <Landing stats={await readStats()} />;
}
