// Dry-run NEAR Intents 1Click quotes: real prices, no funds, no keys. npm run demo:oneclick
// https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote
import { see, step } from './lib/near.mjs';

const API = 'https://1click.chaindefuser.com';
const NEAR_USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const headers = { 'content-type': 'application/json', ...(process.env.ONECLICK_JWT ? { 'X-API-Key': process.env.ONECLICK_JWT } : {}) };
const deadline = () => new Date(Date.now() + 30 * 60_000).toISOString();

const tokens = await (await fetch(`${API}/v0/tokens`)).json();
const baseUsdc = tokens.find((t) => t.symbol === 'USDC' && t.blockchain === 'base');
if (!baseUsdc) throw new Error('USDC on Base is not listed by 1Click');

async function quote(title, body) {
  const r = await fetch(`${API}/v0/quote`, { method: 'POST', headers, body: JSON.stringify({ dry: true, slippageTolerance: 100, depositType: 'ORIGIN_CHAIN', refundType: 'ORIGIN_CHAIN', recipientType: 'DESTINATION_CHAIN', deadline: deadline(), ...body }) });
  const json = await r.json();
  if (!r.ok) throw new Error(`${title}: ${json.message}`);
  see('you pay', `${json.quote.amountInFormatted} (min in ${json.quote.minAmountIn ?? 'n/a'})`);
  see('delivered', json.quote.amountOutFormatted);
  see('estimate', `${json.quote.timeEstimate}s`);
  see('deposit address', json.quote.depositAddress ?? 'none: dry run, so no funds can move');
  if (json.quote.depositAddress) throw new Error('Dry-run quote returned a deposit address');
}

step(1, 'Checkout: pay a 180 USDC fee on NEAR from USDC on Base');
await quote('checkout', {
  swapType: 'EXACT_OUTPUT', originAsset: baseUsdc.assetId, destinationAsset: NEAR_USDC, amount: '180000000',
  refundTo: '0x1111111111111111111111111111111111111111', recipient: 'tenor.near',
});

step(2, 'Payout: send a trader 80 USDC from NEAR to USDC on Base');
await quote('payout', {
  swapType: 'EXACT_INPUT', originAsset: NEAR_USDC, destinationAsset: baseUsdc.assetId, amount: '80000000',
  refundTo: 'tenor.near', recipient: '0x1111111111111111111111111111111111111111',
});

console.log('\nPASS: both legs quoted live with dry:true. No funds moved.');
process.exit(0);
