'use client';

// One shared socket to Coinbase's public trade feed, for every chart on the page.
// https://docs.cdp.coinbase.com/exchange/websocket-feed/channels#ticker-channel
import { useEffect, useState } from 'react';

const URL = 'wss://ws-feed.exchange.coinbase.com';
const SYMBOLS = ['BTC', 'ETH', 'SOL', 'NEAR'];
const SILENCE_MS = 20_000;
const MAX_RETRY_MS = 15_000;
const IDLE_CLOSE_MS = 5000;

export type Tick = { symbol: string; price: number; size: number; time: number; open24: number; volume24: number };
export type FeedStatus = 'connecting' | 'live' | 'down';

type TickFn = (t: Tick) => void;

const listeners = new Map<string, Set<TickFn>>();
const statusListeners = new Set<(s: FeedStatus) => void>();
let socket: WebSocket | null = null;
let status: FeedStatus = 'connecting';
let retryMs = 1000;
let lastMessage = 0;
let watchdog: ReturnType<typeof setInterval> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function setStatus(s: FeedStatus) {
  status = s;
  statusListeners.forEach((f) => f(s));
}

const anyoneListening = () => listeners.size > 0 || statusListeners.size > 0;

function open() {
  if (socket || typeof window === 'undefined') return;
  const ws = new WebSocket(URL);
  socket = ws;
  lastMessage = Date.now();
  ws.onopen = () => {
    retryMs = 1000;
    ws.send(JSON.stringify({ type: 'subscribe', product_ids: SYMBOLS.map((s) => `${s}-USD`), channels: ['ticker', 'heartbeat'] }));
    setStatus('live');
  };
  ws.onmessage = (e) => {
    lastMessage = Date.now();
    const m = JSON.parse(e.data);
    if (m.type !== 'ticker') return;
    const tick: Tick = {
      symbol: m.product_id.split('-')[0],
      price: Number(m.price),
      size: Number(m.last_size),
      time: Date.parse(m.time) / 1000,
      open24: Number(m.open_24h),
      volume24: Number(m.volume_24h),
    };
    listeners.get(tick.symbol)?.forEach((f) => f(tick));
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    if (!anyoneListening()) return;
    setStatus('down');
    retryTimer = setTimeout(open, retryMs);
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
  };
  ws.onerror = () => ws.close();
  // A socket can stay open while the feed has silently stopped.
  watchdog ??= setInterval(() => {
    if (socket && Date.now() - lastMessage > SILENCE_MS) socket.close();
  }, 5000);
}

function closeIfIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (anyoneListening()) return;
    if (retryTimer) clearTimeout(retryTimer);
    if (watchdog) clearInterval(watchdog);
    watchdog = null;
    socket?.close();
    socket = null;
  }, IDLE_CLOSE_MS);
}

/** Calls `fn` for every trade in `symbol`. Returns the unsubscribe function. */
export function subscribeTicks(symbol: string, fn: TickFn) {
  const set = listeners.get(symbol) ?? new Set();
  set.add(fn);
  listeners.set(symbol, set);
  open();
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(symbol);
    closeIfIdle();
  };
}

export function useFeedStatus() {
  const [s, setS] = useState<FeedStatus>(status);
  useEffect(() => {
    statusListeners.add(setS);
    setS(status);
    open();
    return () => {
      statusListeners.delete(setS);
      closeIfIdle();
    };
  }, []);
  return s;
}

/** The latest trade, re-rendering at most once per `everyMs`. */
export function useLiveTick(symbol: string, everyMs = 300) {
  const [tick, setTick] = useState<Tick | null>(null);
  useEffect(() => {
    setTick(null);
    let latest: Tick | null = null;
    const id = setInterval(() => {
      if (latest) {
        setTick(latest);
        latest = null;
      }
    }, everyMs);
    const off = subscribeTicks(symbol, (t) => {
      latest = t;
    });
    return () => {
      clearInterval(id);
      off();
    };
  }, [symbol, everyMs]);
  return tick;
}
