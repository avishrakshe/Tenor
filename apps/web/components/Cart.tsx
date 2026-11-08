'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { productName, productSize } from '@/lib/catalog';
import { usd, view, type Challenge } from '@/lib/chain';
import { CheckoutQuote } from './OneClick';
import { useSession } from './Session';
import { Notice, usePoll } from './ui';

export type CartItem = { product: string; fee: string; qty: number };

type Cart = {
  items: CartItem[];
  open: 'none' | 'cart' | 'checkout';
  setOpen: (o: Cart['open']) => void;
  add: (product: string, fee: string) => void;
  setQty: (product: string, qty: number) => void;
  count: number;
  subtotal: bigint;
  sizeInCart: number;
  clear: () => void;
};

const Ctx = createContext<Cart | null>(null);
const KEY = 'tenor.cart';

export const useCart = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('No cart');
  return c;
};

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [open, setOpen] = useState<Cart['open']>('none');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setItems(JSON.parse(saved));
    } catch {
      // A cart that can't be restored just starts empty.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      // Storage can be blocked; the cart then lasts for this page only.
    }
  }, [items]);

  const add = useCallback((product: string, fee: string) => {
    setItems((prev) => {
      const hit = prev.find((i) => i.product === product);
      return hit ? prev.map((i) => (i.product === product ? { ...i, qty: i.qty + 1 } : i)) : [...prev, { product, fee, qty: 1 }];
    });
    setOpen('cart');
  }, []);

  const setQty = useCallback((product: string, qty: number) => {
    setItems((prev) => (qty <= 0 ? prev.filter((i) => i.product !== product) : prev.map((i) => (i.product === product ? { ...i, qty } : i))));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo(
    () => ({
      items,
      open,
      setOpen,
      add,
      setQty,
      clear,
      count: items.reduce((a, i) => a + i.qty, 0),
      subtotal: items.reduce((a, i) => a + BigInt(i.fee) * BigInt(i.qty), 0n),
      sizeInCart: items.reduce((a, i) => a + productSize(i.product) * i.qty, 0),
    }),
    [items, open, add, setQty, clear],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function CartButton() {
  const { count, open, setOpen } = useCart();
  return (
    <button className="relative grid h-10 w-10 place-items-center rounded-full border border-line bg-raised" aria-label={`Cart, ${count} items`} onClick={() => setOpen(open === 'cart' ? 'none' : 'cart')}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2 5h12l-1 9H3L2 5zM5.5 5V3.5a2.5 2.5 0 015 0V5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
      {count > 0 && <span className="num absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-[11px] text-black">{count}</span>}
    </button>
  );
}

function Stepper({ product, qty }: { product: string; qty: number }) {
  const { setQty } = useCart();
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center rounded-lg border border-line">
        <button className="h-9 w-9" aria-label="Remove one" onClick={() => setQty(product, qty - 1)}>−</button>
        <span className="num w-8 text-center text-sm">{qty}</span>
        <button className="h-9 w-9" aria-label="Add one" onClick={() => setQty(product, qty + 1)}>+</button>
      </div>
      <button className="ml-auto text-sm text-mute hover:text-text" onClick={() => setQty(product, 0)}>Remove</button>
    </div>
  );
}

function Line({ item }: { item: CartItem }) {
  return (
    <div>
      <div className="flex justify-between gap-3">
        <div>
          <div className="font-medium">{productName(item.product)}</div>
          <div className="label">Account: {productSize(item.product).toLocaleString('en-US')} USDC</div>
        </div>
        <div className="num">{usd(BigInt(item.fee) * BigInt(item.qty))}</div>
      </div>
      <div className="mt-3"><Stepper product={item.product} qty={item.qty} /></div>
    </div>
  );
}

export function CapitalBar({ active, inCart }: { active: number; inCart: number }) {
  const pct = (n: number) => `${Math.min((n / 200_000) * 100, 100)}%`;
  return (
    <div>
      <div className="flex justify-between text-sm text-mute">
        <span>Active capital <b className="num text-text">${active.toLocaleString('en-US')}</b> / $200,000</span>
        {inCart > 0 && <span className="num">+${inCart.toLocaleString('en-US')} in cart</span>}
      </div>
      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Active capital" aria-valuemin={0} aria-valuemax={200000} aria-valuenow={active}>
        <div className="absolute inset-y-0 left-0 bg-up/40 transition-all" style={{ width: pct(active + inCart) }} />
        <div className="absolute inset-y-0 left-0 bg-up transition-all" style={{ width: pct(active) }} />
      </div>
    </div>
  );
}

export function useActiveCapital() {
  const { config, accountId } = useSession();
  const { data } = usePoll(
    () => (accountId && config.deployed ? view<Challenge[]>(config.rpc, config.stack.tenor, 'challenges_of', { owner: accountId }) : Promise.resolve([] as Challenge[])),
    [accountId, config.deployed, config.stack.tenor],
    15_000,
  );
  return (data ?? []).filter((c) => c.status === 'Active' && c.product !== 'demo').reduce((a, c) => a + Number(BigInt(c.initial_balance) / 1_000_000n), 0);
}

function CartPopover() {
  const { items, open, setOpen, subtotal, count } = useCart();
  return (
    <AnimatePresence>
      {open === 'cart' && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          role="dialog"
          aria-label="Your cart"
          className="fixed top-16 right-3 z-50 w-[min(400px,calc(100vw-24px))] rounded-xl border border-line bg-panel shadow-2xl shadow-black"
        >
          <div className="flex items-center justify-between border-b border-line p-5">
            <div className="font-semibold">Your cart <span className="ml-2 text-sm font-normal text-mute">{count} {count === 1 ? 'challenge' : 'challenges'}</span></div>
            <button aria-label="Close cart" onClick={() => setOpen('none')} className="text-mute hover:text-text">✕</button>
          </div>
          {items.length === 0 ? (
            <p className="p-5 text-sm text-mute">Your cart is empty.</p>
          ) : (
            <>
              <div className="max-h-[50vh] space-y-5 overflow-y-auto border-b border-line p-5">
                {items.map((i) => <Line key={i.product} item={i} />)}
              </div>
              <div className="p-5">
                <div className="flex justify-between text-sm text-mute"><span>Subtotal</span><span className="num text-text">{usd(subtotal)}</span></div>
                <p className="label mt-2">Each evaluation opens as its own account.</p>
                <button className="btn mt-4 w-full" onClick={() => setOpen('checkout')}>Checkout</button>
                <button className="btn btn-ghost mt-2 w-full" onClick={() => setOpen('none')}>Continue shopping</button>
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Checkout() {
  const { items, open, setOpen, subtotal, sizeInCart, clear } = useCart();
  const { config, accountId, sendMany, send } = useSession();
  const router = useRouter();
  const active = useActiveCapital();
  const [method, setMethod] = useState<'near' | 'bridge'>('near');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const balance = usePoll(
    () => (accountId && config.deployed ? view<string>(config.rpc, config.usdc, 'ft_balance_of', { account_id: accountId }) : Promise.resolve('0')),
    [accountId, config.deployed, open],
    8000,
  );

  const overCap = active + sizeInCart > 200_000;
  const short = balance.data !== null && BigInt(balance.data) < subtotal;

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      await send({ receiverId: config.usdc, method: 'mint', args: { account_id: accountId, amount: String(subtotal + 1_000_000_000n) }, gas: '30000000000000' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const calls = items.flatMap((i) =>
        Array.from({ length: i.qty }, () => ({
          receiverId: config.usdc,
          method: 'ft_transfer_call',
          args: { receiver_id: config.stack.tenor, amount: i.fee, msg: JSON.stringify({ action: 'buy', product: i.product }) },
          deposit: '1',
          gas: '100000000000000',
        })),
      );
      const results = (await sendMany(calls)) as { status?: { Failure?: unknown } }[];
      const failed = results.find((r) => r?.status?.Failure);
      if (failed) throw new Error(JSON.stringify(failed.status?.Failure).slice(0, 200));
      clear();
      setOpen('none');
      setAgreed(false);
      router.push('/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const methods = [
    { id: 'near' as const, title: 'USDC on NEAR', note: 'Paid straight to the Tenor contract' },
    { id: 'bridge' as const, title: 'From another chain', note: 'NEAR Intents. Dry-run quote only for now' },
  ];

  return (
    <>
      <CartPopover />
      <AnimatePresence>
        {open === 'checkout' && (
          <>
            <motion.div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen('none')} />
            <motion.aside
              role="dialog"
              aria-label="Checkout"
              className="fixed inset-y-0 right-0 z-50 flex w-[min(600px,100vw)] flex-col border-l border-line bg-panel"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            >
              <div className="flex items-center gap-3 border-b border-line p-5">
                <button aria-label="Back to cart" onClick={() => setOpen('cart')} className="text-mute hover:text-text">‹</button>
                <h2 className="text-lg font-semibold">Checkout</h2>
              </div>
              <div className="flex-1 space-y-6 overflow-y-auto p-5">
                <fieldset>
                  <legend className="mb-2 text-sm text-mute">Payment method</legend>
                  <div className="space-y-2">
                    {methods.map((m) => (
                      <label key={m.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 ${method === m.id ? 'border-up bg-up/5' : 'border-line'}`}>
                        <input type="radio" name="pay" checked={method === m.id} onChange={() => setMethod(m.id)} />
                        <span><span className="block font-medium">{m.title}</span><span className="label">{m.note}</span></span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                {method === 'bridge' && <CheckoutQuote defaultUsdc={Number(subtotal) / 1e6} />}
                <section>
                  <h3 className="mb-2 text-sm text-mute">Order summary</h3>
                  <div className="space-y-5 rounded-lg border border-line p-4">
                    {items.map((i) => <Line key={i.product} item={i} />)}
                  </div>
                </section>
                <section className="rounded-lg border border-line p-4">
                  <div className="flex justify-between font-semibold"><span>Total</span><span className="num">{usd(subtotal)}</span></div>
                  {accountId && config.deployed && (
                    <div className="mt-2 flex items-center justify-between text-sm text-mute">
                      <span>Your USDC: <span className="num text-text">{balance.data ? usd(balance.data) : '—'}</span></span>
                      {short && <button className="underline underline-offset-2 hover:text-text" onClick={mint} disabled={busy}>Get test USDC</button>}
                    </div>
                  )}
                </section>
                <label className="flex cursor-pointer gap-3 text-sm text-mute">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
                  <span>I understand these rules are enforced by contract, and a breach ends the account with no appeal.</span>
                </label>
                <div className="rounded-lg border border-line p-4"><CapitalBar active={active} inCart={sizeInCart} /></div>
                {overCap && <Notice tone="error">This order would take you over the $200,000 active limit.</Notice>}
                {error && <Notice tone="error">{error}</Notice>}
              </div>
              <div className="border-t border-line p-5">
                {accountId ? (
                  <button className="btn w-full" disabled={!agreed || busy || overCap || short || method !== 'near' || !config.deployed || items.length === 0} onClick={pay}>
                    {busy ? 'Confirming…' : `Pay ${usd(subtotal)}`}
                  </button>
                ) : (
                  <button className="btn w-full" onClick={() => { setOpen('none'); router.push('/login'); }}>Log in to pay</button>
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
