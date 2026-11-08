'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from '@/components/Session';
import { BuyGate, TradeTerminal } from '@/components/TradeTerminal';
import { isLive, readAccounts } from '@/lib/accounts';

/** Opens the trader's first live account, or the market view with a prompt to buy one. */
export default function TradeHome() {
  const { config, accountId } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!accountId || !config.deployed) return;
    readAccounts(config.rpc, config.stack.tenor, accountId)
      .then((rows) => {
        const live = rows.find(isLive);
        if (live) router.replace(live.href);
      })
      .catch(() => {});
  }, [accountId, config.deployed, config.rpc, config.stack.tenor, router]);

  return <TradeTerminal account={null} canTrade={false} busy={false} message={null} gate={<BuyGate />} onBuy={() => {}} onClose={() => {}} />;
}
