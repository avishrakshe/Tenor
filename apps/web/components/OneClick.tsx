'use client';

// NEAR Intents 1Click. Quotes are dry-run by default: real prices, no funds moved.
// https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote
import { useEffect, useState } from 'react';
import { Notice } from './ui';

// Quotes need a syntactically valid address on the chain. Dry-run only, so nothing is sent to it.
const EVM_CHAINS = new Set(['eth', 'base', 'arb', 'pol', 'bsc', 'op', 'avax', 'gnosis']);
const NEAR_USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';

export const STATUS_TEXT: Record<string, string> = {
  PENDING_DEPOSIT: 'Waiting for the deposit',
  KNOWN_DEPOSIT_TX: 'Deposit seen on the origin chain',
  INCOMPLETE_DEPOSIT: 'Deposit below the required amount',
  PROCESSING: 'Swap in progress',
  SUCCESS: 'Delivered',
  REFUNDED: 'Refunded to the refund address',
  FAILED: 'Failed',
};

type Token = { assetId: string; symbol: string; blockchain: string; decimals: number };
type Quote = { quote: { amountInFormatted: string; amountOutFormatted: string; minAmountOut: string; timeEstimate: number } };

function useTokens() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/oneclick/tokens')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((all: Token[]) => setTokens(all.filter((t) => EVM_CHAINS.has(t.blockchain))), (e) => setError(e.message));
  }, []);
  return { tokens, error };
}

async function quote(body: object): Promise<Quote> {
  const r = await fetch('/api/oneclick/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.message ?? `HTTP ${r.status}`);
  return json;
}

const label = (t: Token) => `${t.symbol} on ${t.blockchain}`;

function TokenSelect({ tokens, value, onChange, id }: { tokens: Token[]; value: string; onChange: (v: string) => void; id: string }) {
  return (
    <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
      {tokens.map((t) => (
        <option key={t.assetId} value={t.assetId}>
          {label(t)}
        </option>
      ))}
    </select>
  );
}

const DEADLINE_MS = 30 * 60 * 1000;

/** What a fee would cost paid from another chain. */
export function CheckoutQuote() {
  const { tokens, error } = useTokens();
  const [origin, setOrigin] = useState('');
  const [usdcOut, setUsdcOut] = useState('180');
  const [result, setResult] = useState<Quote | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const originAsset = origin || tokens.find((t) => t.symbol === 'USDC' && t.blockchain === 'base')?.assetId || tokens[0]?.assetId || '';

  async function get() {
    setProblem(null);
    setResult(null);
    try {
      setResult(
        await quote({
          dry: true,
          swapType: 'EXACT_OUTPUT',
          slippageTolerance: 100,
          originAsset,
          destinationAsset: NEAR_USDC,
          amount: String(BigInt(Math.round(Number(usdcOut) * 1e6))),
          depositType: 'ORIGIN_CHAIN',
          refundTo: '0x1111111111111111111111111111111111111111',
          refundType: 'ORIGIN_CHAIN',
          recipient: 'tenor.near',
          recipientType: 'DESTINATION_CHAIN',
          deadline: new Date(Date.now() + DEADLINE_MS).toISOString(),
        }),
      );
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="panel space-y-3" aria-labelledby="checkout">
      <div>
        <h2 id="checkout" className="text-sm font-semibold">
          Pay from any chain
        </h2>
        <p className="mt-1 text-sm text-mute">Live NEAR Intents dry-run quote. Moves no funds.</p>
      </div>
      {error && <Notice tone="error">Token list unavailable: {error}</Notice>}
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className="label" htmlFor="co-from">
            Pay with
          </label>
          <TokenSelect id="co-from" tokens={tokens} value={originAsset} onChange={setOrigin} />
        </div>
        <div>
          <label className="label" htmlFor="co-amt">
            USDC needed on NEAR
          </label>
          <input id="co-amt" className="field num" inputMode="decimal" value={usdcOut} onChange={(e) => setUsdcOut(e.target.value)} />
        </div>
        <div className="flex items-end">
          <button className="btn btn-ghost w-full" onClick={get} disabled={!originAsset}>
            Get dry-run quote
          </button>
        </div>
      </div>
      {problem && <Notice tone="error">{problem}</Notice>}
      {result && (
        <p className="num text-sm">
          Pay {result.quote.amountInFormatted}, receive {result.quote.amountOutFormatted} USDC, about {result.quote.timeEstimate}s.
        </p>
      )}
    </section>
  );
}

/** What a payout would deliver on another chain. */
export function PayoutQuote({ amountMicro }: { amountMicro: string }) {
  const { tokens, error } = useTokens();
  const [dest, setDest] = useState('');
  const [recipient, setRecipient] = useState('');
  const [result, setResult] = useState<Quote | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const destinationAsset = dest || tokens.find((t) => t.symbol === 'USDC' && t.blockchain === 'base')?.assetId || tokens[0]?.assetId || '';

  async function get() {
    setProblem(null);
    setResult(null);
    try {
      setResult(
        await quote({
          dry: true,
          swapType: 'EXACT_INPUT',
          slippageTolerance: 100,
          originAsset: NEAR_USDC,
          destinationAsset,
          amount: amountMicro,
          depositType: 'ORIGIN_CHAIN',
          refundTo: 'tenor.near',
          refundType: 'ORIGIN_CHAIN',
          recipient: recipient || '0x1111111111111111111111111111111111111111',
          recipientType: 'DESTINATION_CHAIN',
          deadline: new Date(Date.now() + DEADLINE_MS).toISOString(),
        }),
      );
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-mute">Dry-run quote for a payout to another chain. Moves no funds.</p>
      {error && <Notice tone="error">Token list unavailable: {error}</Notice>}
      <div>
        <label className="label" htmlFor="po-to">
          Receive as
        </label>
        <TokenSelect id="po-to" tokens={tokens} value={destinationAsset} onChange={setDest} />
      </div>
      <div>
        <label className="label" htmlFor="po-addr">
          Address on that chain
        </label>
        <input id="po-addr" className="field num" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
      </div>
      <button className="btn btn-ghost" onClick={get} disabled={!destinationAsset || amountMicro === '0'}>
        Get dry-run quote
      </button>
      {problem && <Notice tone="error">{problem}</Notice>}
      {result && (
        <p className="num text-sm">
          {result.quote.amountInFormatted} USDC becomes {result.quote.amountOutFormatted}, about {result.quote.timeEstimate}s.
        </p>
      )}
    </div>
  );
}
