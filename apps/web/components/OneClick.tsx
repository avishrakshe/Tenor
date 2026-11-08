'use client';

// NEAR Intents 1Click. Quotes are dry-run by default: real prices, no funds moved.
// https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote
import { useEffect, useRef, useState } from 'react';
import { Notice } from './ui';

// Quotes need a syntactically valid address on the chain. Dry-run only, so nothing is sent to it.
const EVM_CHAINS = new Set(['eth', 'base', 'arb', 'pol', 'bsc', 'op', 'avax', 'gnosis']);
const NEAR_USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const PLACEHOLDER = '0x1111111111111111111111111111111111111111';
const DEADLINE_MS = 30 * 60 * 1000;
const POLL_MS = 5000;

/** Where the money is at each status. */
export const STATUS_TEXT: Record<string, { label: string; where: string; tone: 'info' | 'good' | 'bad'; step: number }> = {
  PENDING_DEPOSIT: { label: 'Waiting for the deposit', where: 'Still in your wallet. Nothing has moved yet.', tone: 'info', step: 0 },
  KNOWN_DEPOSIT_TX: { label: 'Deposit seen', where: 'On its way to the 1Click deposit address.', tone: 'info', step: 1 },
  PROCESSING: { label: 'Swapping', where: 'Held by NEAR Intents while the swap settles.', tone: 'info', step: 2 },
  SUCCESS: { label: 'Delivered', where: 'At the recipient address.', tone: 'good', step: 3 },
  INCOMPLETE_DEPOSIT: { label: 'Deposit too small', where: 'At the deposit address. Below the required amount, so it is refunded after the deadline.', tone: 'bad', step: 1 },
  REFUNDED: { label: 'Refunded', where: 'Back at your refund address.', tone: 'bad', step: 0 },
  FAILED: { label: 'Failed', where: 'The swap did not complete. Check the refund address and the transactions below.', tone: 'bad', step: 2 },
};

const TERMINAL = new Set(['SUCCESS', 'INCOMPLETE_DEPOSIT', 'REFUNDED', 'FAILED']);

type Token = { assetId: string; symbol: string; blockchain: string; decimals: number };
type Quote = {
  quote: {
    amountInFormatted: string;
    amountOutFormatted: string;
    amountInUsd?: string;
    amountOutUsd?: string;
    minAmountOut: string;
    timeEstimate: number;
  };
};
type Judged = { quote: Quote; costPct: number | null; rejected: boolean };

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

/** Total cost of the quote in USD terms, and whether it is over the user's limit. */
export function judgeQuote(quote: Quote, limitPct: number): Judged {
  const inUsd = Number(quote.quote.amountInUsd);
  const outUsd = Number(quote.quote.amountOutUsd);
  const costPct = inUsd > 0 && outUsd > 0 ? ((inUsd - outUsd) / inUsd) * 100 : null;
  return { quote, costPct, rejected: costPct === null || costPct > limitPct };
}

async function fetchQuote(body: object): Promise<Quote> {
  const r = await fetch('/api/oneclick/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.message ?? `HTTP ${r.status}`);
  return json;
}

function TokenSelect({ tokens, value, onChange, id }: { tokens: Token[]; value: string; onChange: (v: string) => void; id: string }) {
  return (
    <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
      {tokens.map((t) => (
        <option key={t.assetId} value={t.assetId}>
          {t.symbol} on {t.blockchain}
        </option>
      ))}
    </select>
  );
}

function SlippageField({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  return (
    <div>
      <label className="label" htmlFor={id}>Max total cost (%)</label>
      <input id={id} className="field num" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** The route money takes. `at` is the current stop, or null for a preview. */
export function FundsPath({ stops, at = null, bad = false }: { stops: string[]; at?: number | null; bad?: boolean }) {
  return (
    <ol className="flex flex-wrap items-center gap-y-2 text-xs" aria-label="Where the funds go">
      {stops.map((s, i) => (
        <li key={s} className="flex items-center">
          <span aria-current={at === i ? 'step' : undefined} className={`rounded-full border px-2.5 py-1 ${at === i ? (bad ? 'border-down text-down' : 'border-up text-up') : 'border-line text-mute'}`}>
            {s}
          </span>
          {i < stops.length - 1 && <span className="px-1 text-mute" aria-hidden="true">→</span>}
        </li>
      ))}
    </ol>
  );
}

function QuoteResult({ result, unit }: { result: Judged; unit?: string }) {
  const q = result.quote.quote;
  return (
    <div className="space-y-1 text-sm">
      <p className="num">
        {q.amountInFormatted} becomes {q.amountOutFormatted}{unit ? ` ${unit}` : ''}, about {q.timeEstimate}s.
      </p>
      <p className="num text-mute">Total cost: {result.costPct === null ? 'unknown' : `${result.costPct.toFixed(2)}%`}</p>
      {result.rejected ? (
        <Notice tone="error">Rejected: this quote costs more than your limit, so it would not be executed.</Notice>
      ) : (
        <Notice>Within your limit. Dry run: no deposit address was issued, so no funds can move.</Notice>
      )}
    </div>
  );
}

type Status = {
  status: string;
  message?: string;
  updatedAt?: string;
  swapDetails?: {
    originChainTxHashes?: { hash: string; explorerUrl: string }[];
    destinationChainTxHashes?: { hash: string; explorerUrl: string }[];
    refundedAmount?: string;
    refundReason?: string;
  };
};

const TRACK_STOPS = ['Your wallet', 'Deposit address', 'NEAR Intents', 'Recipient'];

/** Follows a real swap by deposit address, including refunds and failures. */
export function SwapTracker() {
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function poll(target: string) {
    try {
      const r = await fetch(`/api/oneclick/status?depositAddress=${encodeURIComponent(target)}`);
      const j: Status = await r.json();
      if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
      setStatus(j);
      setError(null);
      if (!TERMINAL.has(j.status)) timer.current = setTimeout(() => poll(target), POLL_MS);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const info = status ? STATUS_TEXT[status.status] : null;
  const txs = [...(status?.swapDetails?.originChainTxHashes ?? []), ...(status?.swapDetails?.destinationChainTxHashes ?? [])];

  return (
    <details className="rounded-lg border border-line p-3">
      <summary className="cursor-pointer text-sm">Track a swap</summary>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (timer.current) clearTimeout(timer.current);
          setStatus(null);
          poll(address.trim());
        }}
      >
        <input className="field num" aria-label="Deposit address" placeholder="1Click deposit address" value={address} onChange={(e) => setAddress(e.target.value)} />
        <button className="btn btn-ghost" disabled={!address.trim()}>Track</button>
      </form>
      {error && <div className="mt-2"><Notice tone="error">{error}</Notice></div>}
      {status && (
        <div className="mt-3 space-y-2">
          <FundsPath stops={TRACK_STOPS} at={info?.step ?? null} bad={info?.tone === 'bad'} />
          <p className={`text-sm font-medium ${info?.tone === 'bad' ? 'text-down' : info?.tone === 'good' ? 'text-up' : ''}`} role="status">
            {info?.label ?? status.status}
          </p>
          <p className="text-sm text-mute">{info?.where ?? 'Unknown status.'}</p>
          {status.swapDetails?.refundReason && <p className="text-sm text-down">Reason: {status.swapDetails.refundReason}</p>}
          {status.swapDetails?.refundedAmount && <p className="num text-sm">Refunded: {status.swapDetails.refundedAmount}</p>}
          {txs.map((t) => (
            <a key={t.hash} href={t.explorerUrl} className="num block truncate text-xs underline underline-offset-2">{t.hash}</a>
          ))}
        </div>
      )}
    </details>
  );
}

/** What a fee would cost paid from another chain. */
export function CheckoutQuote({ defaultUsdc = 180 }: { defaultUsdc?: number }) {
  const { tokens, error } = useTokens();
  const [origin, setOrigin] = useState('');
  const [usdcOut, setUsdcOut] = useState(String(defaultUsdc));
  const [limit, setLimit] = useState('1');
  const [result, setResult] = useState<Judged | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const originAsset = origin || tokens.find((t) => t.symbol === 'USDC' && t.blockchain === 'base')?.assetId || tokens[0]?.assetId || '';
  const chosen = tokens.find((t) => t.assetId === originAsset);

  async function get() {
    setProblem(null);
    setResult(null);
    try {
      const pct = Number(limit);
      const quote = await fetchQuote({
        dry: true,
        swapType: 'EXACT_OUTPUT',
        slippageTolerance: Math.round(pct * 100),
        originAsset,
        destinationAsset: NEAR_USDC,
        amount: String(BigInt(Math.round(Number(usdcOut) * 1e6))),
        depositType: 'ORIGIN_CHAIN',
        refundTo: PLACEHOLDER,
        refundType: 'ORIGIN_CHAIN',
        recipient: 'tenor.near',
        recipientType: 'DESTINATION_CHAIN',
        deadline: new Date(Date.now() + DEADLINE_MS).toISOString(),
      });
      setResult(judgeQuote(quote, pct));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="panel space-y-3" aria-labelledby="checkout-quote">
      <div>
        <h3 id="checkout-quote" className="text-sm font-semibold">Pay from any chain</h3>
        <p className="mt-1 text-sm text-mute">Live NEAR Intents dry-run quote. Moves no funds.</p>
      </div>
      {error && <Notice tone="error">Token list unavailable: {error}</Notice>}
      <FundsPath stops={[`Your wallet${chosen ? ` on ${chosen.blockchain}` : ''}`, 'Deposit address', 'NEAR Intents', 'Your NEAR account', 'Tenor contract']} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="co-from">Pay with</label>
          <TokenSelect id="co-from" tokens={tokens} value={originAsset} onChange={setOrigin} />
        </div>
        <div>
          <label className="label" htmlFor="co-amt">USDC needed on NEAR</label>
          <input id="co-amt" className="field num" inputMode="decimal" value={usdcOut} onChange={(e) => setUsdcOut(e.target.value)} />
        </div>
        <SlippageField id="co-limit" value={limit} onChange={setLimit} />
      </div>
      <button className="btn btn-ghost w-full" onClick={get} disabled={!originAsset}>Get dry-run quote</button>
      {problem && <Notice tone="error">{problem}</Notice>}
      {result && <QuoteResult result={result} unit="USDC" />}
      <SwapTracker />
    </section>
  );
}

/** What a payout would deliver on another chain. */
export function PayoutQuote({ amountMicro }: { amountMicro: string }) {
  const { tokens, error } = useTokens();
  const [dest, setDest] = useState('');
  const [recipient, setRecipient] = useState('');
  const [limit, setLimit] = useState('1');
  const [result, setResult] = useState<Judged | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const destinationAsset = dest || tokens.find((t) => t.symbol === 'USDC' && t.blockchain === 'base')?.assetId || tokens[0]?.assetId || '';
  const chosen = tokens.find((t) => t.assetId === destinationAsset);

  async function get() {
    setProblem(null);
    setResult(null);
    try {
      const pct = Number(limit);
      const quote = await fetchQuote({
        dry: true,
        swapType: 'EXACT_INPUT',
        slippageTolerance: Math.round(pct * 100),
        originAsset: NEAR_USDC,
        destinationAsset,
        amount: amountMicro,
        depositType: 'ORIGIN_CHAIN',
        refundTo: 'tenor.near',
        refundType: 'ORIGIN_CHAIN',
        recipient: recipient || PLACEHOLDER,
        recipientType: 'DESTINATION_CHAIN',
        deadline: new Date(Date.now() + DEADLINE_MS).toISOString(),
      });
      setResult(judgeQuote(quote, pct));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-mute">Dry-run quote for a payout to another chain. Moves no funds.</p>
      {error && <Notice tone="error">Token list unavailable: {error}</Notice>}
      <FundsPath stops={['Guard contract', 'Deposit address', 'NEAR Intents', `Your address${chosen ? ` on ${chosen.blockchain}` : ''}`]} />
      <div>
        <label className="label" htmlFor="po-to">Receive as</label>
        <TokenSelect id="po-to" tokens={tokens} value={destinationAsset} onChange={setDest} />
      </div>
      <div>
        <label className="label" htmlFor="po-addr">Address on that chain</label>
        <input id="po-addr" className="field num" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
      </div>
      <SlippageField id="po-limit" value={limit} onChange={setLimit} />
      <button className="btn btn-ghost w-full" onClick={get} disabled={!destinationAsset || amountMicro === '0'}>Get dry-run quote</button>
      {problem && <Notice tone="error">{problem}</Notice>}
      {result && <QuoteResult result={result} />}
      <SwapTracker />
    </div>
  );
}
