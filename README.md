# Tenor

Tenor is a retail prop-trading firm whose rules run as NEAR contracts. A trader pays once for an
evaluation, and if they hit the target inside the loss limits they trade real capital and keep 80%
of the profit. The firm cannot hold trades in-house, cannot change a verdict, and cannot move a
funded account's money.

Tracks: `defi`, `security`. Other submission: none.

## Status

| Part | State |
|---|---|
| Contracts, rules, demos, attack demo | Run end to end on NEAR testnet and on a local sandbox |
| 1Click checkout and payout quotes | Live mainnet quotes, dry-run only |
| Testnet deployment | Live. Ids below |
| Web app | Live at https://tenor-hazel-theta.vercel.app |
| Wallet login on testnet | Built, not yet tested with a real wallet |
| Mainnet swaps through Rhea | Adapter written and unit tested, **never run on mainnet** |
| Chain Signatures, LP shares | Not built |

## Problem

Most prop firms run a B-book: trades stay in-house and the firm earns when traders lose. The trader
has to trust that fills, breaches and payouts are honest, and that the firm can pay at all.

## How NEAR enforces each promise

| Promise | Mechanism | Code |
|---|---|---|
| No B-book: every funded trade is a real swap | Each funded account is its own sub-account running a Guard. It swaps with `ft_transfer_call` to the venue, then rebuilds its book from token balances. Tenor adds no full-access key. | [`fund`](contracts/tenor/src/lib.rs), [`swap`](contracts/guard/src/lib.rs), [`on_balances`](contracts/guard/src/lib.rs) |
| Trade-only keys | The trader holds a function-call key limited to `place_order`, `close_position` and `request_payout`. Such keys can't attach deposits, transfer NEAR or add keys. A breach deletes the key in the same receipt. | [`TRADER_METHODS`, `breach`](contracts/guard/src/lib.rs) |
| Every loss is pre-funded | `fund` panics unless reserve >= (live max loss + new max loss) x 1.2. After the fee, the only income is 20% of realised profit. | [`reserve_covers`](crates/tenor-rules/src/lib.rs), [`fund`](contracts/tenor/src/lib.rs) |
| One rulebook | Evaluations and funded accounts call the same `evaluate`, in a crate with no blockchain dependency. | [`evaluate`](crates/tenor-rules/src/lib.rs) |
| Unstoppable rules | `poke` is permissionless. Anyone can apply rollover, stops, breaches and liquidation. | [`poke`](contracts/tenor/src/lib.rs) |

Rules run in a fixed order: TP/SL, UTC rollover, breach, pass. If a price is older than 60 seconds
there are no fills and no breaches, so bad data can't end an account.

## Try it in 5 minutes (sandbox, no funds, no keys, no Rust)

Needs Node 22+ on Linux, macOS, or Windows with WSL Ubuntu. Compiled contracts are in `wasm/`.

1. Run `npm install`.
2. In a second terminal, run `npm run sandbox`. **See:** `Sandbox RPC: http://127.0.0.1:3030`.
3. Run `npm run deploy -- --network sandbox`. **See:** `Deployed to sandbox.`
4. Run `npm run demo:eval -- --network sandbox`. **See:** `status: Passed` and `PASS`. A challenge is bought, traded and passed entirely onchain.
5. Run `npm run demo:breach -- --network sandbox`. **See:**
   - `keys on guard: 1` with a `FunctionCall` permission after funding
   - `status: Breached (daily_loss)` after a 4% fall
   - `keys on guard: 0`, then `rejected by the protocol`
   - `capital returned` and `PASS`
6. Run `npm run attack-demo -- --network sandbox`. **See:** five `PASS` lines in the summary.
7. Run `npm run demo:oneclick`. **See:** real quotes in both directions and `deposit address: none`.

The demos use a separate stack whose oracle accepts scripted prices, because a real +10% move can't
be waited for. Its price is the only thing scripted: the contracts are the same.

### Web app on the sandbox

1. Keep the sandbox running and run `npm run keeper -- --network sandbox` for real-time prices.
2. Run `NEXT_PUBLIC_NETWORK=sandbox npm run dev`, then open http://localhost:3000.
3. Click **Open app**, then **Log in**, then **Create sandbox account**. **See:** your dashboard.
4. Open **Buy Challenge**, pick **Demo** and click **Start demo**. **See:** the evaluation on your dashboard.
5. Open it, click **MAX**, then **Buy BTC**. **See:** a position with breach and pass prices, and the risk meters move.
6. Open `/transparency`. **See:** reserve, coverage and every funded account and breach, read live from the contract.

## Testnet

The contracts are deployed, so these run against the live demo stack.

1. Run `npm run faucet`. **See:** a new account with 10 NEAR, saved to `.env`.
2. Run `npm run demo:eval -- --network testnet`. **See:** `PASS`, plus an explorer link per transaction.
3. Run `npm run demo:breach -- --network testnet` and `npm run attack-demo -- --network testnet`.

To deploy your own: put a funded account in `.env` and run `npm run deploy -- --network testnet`.
That needs about 27 NEAR with `--guard bytes`, where the factory deploys the Guard code directly. The default, a global contract, burns about 25 more when published.

## Dry-run 1Click

`npm run demo:oneclick`, or the *Pay from any chain* panel on `/challenges` and the payout panel on
a funded account. Quotes use `dry: true`, so 1Click returns prices and no deposit address. Live
quotes are refused unless `ONECLICK_ALLOW_LIVE=1`. No key is needed; without one 1Click adds 0.25%.

Checkout delivers to the user's NEAR account and the UI then calls `ft_transfer_call`. 1Click's
`customRecipientMsg` could deliver straight to the contract, but its docs mark it highly
experimental and say funds can be lost. For payouts, `request_payout(deposit_address)` sends only
the trader's own share there, so a bad address can only hurt the trader.

## Attack demo

An agent holding only the Guard's function-call key obeys a prompt injection. It runs with a
scripted worst-case mock by default; `--llm` with `ANTHROPIC_API_KEY` uses a real model.

| Attack | Stopped by | Evidence |
|---|---|---|
| Transfer NEAR to an attacker | NEAR protocol | `Access key requires full access` |
| Add a full-access key | NEAR protocol | Same error, still one key on the account |
| Order above the notional cap | Guard | `order_rejected`, reason `notional_cap` |
| Trade until breach | Guard | Status `Breached`, zero keys left |
| Trade after the breach | NEAR protocol | `Access key ... does not exist` |

## Deployed contracts

Testnet ids are also in [`deployments/testnet.json`](deployments/testnet.json).

| Contract | Account |
|---|---|
| Tenor (live prices) | [tenor.testnet](https://testnet.nearblocks.io/address/tenor.testnet) |
| Tenor (demo stack, scripted prices) | [demo.tenor.testnet](https://testnet.nearblocks.io/address/demo.tenor.testnet) |
| Oracle | [oracle.tenor.testnet](https://testnet.nearblocks.io/address/oracle.tenor.testnet), [demo-oracle.tenor.testnet](https://testnet.nearblocks.io/address/demo-oracle.tenor.testnet) |
| Mock swap venue | [swap.tenor.testnet](https://testnet.nearblocks.io/address/swap.tenor.testnet), [demo-swap.tenor.testnet](https://testnet.nearblocks.io/address/demo-swap.tenor.testnet) |
| Mock USDC | [usdc.tenor.testnet](https://testnet.nearblocks.io/address/usdc.tenor.testnet) |
| Mock market tokens | `btc`, `eth`, `sol` and `near` `.tenor.testnet` |

A funded Guard from the demo run, with its trader key deleted: [1.demo.tenor.testnet](https://testnet.nearblocks.io/address/1.demo.tenor.testnet). The transaction that breached it: [38t6cptm…](https://testnet.nearblocks.io/txns/38t6cptmVT2rNUppo13ubnUaVDspUPUtfsnaUKcFjRz8).

External dependencies, checked against the live chain or docs:

| Contract | Network | Use |
|---|---|---|
| `v2.ref-finance.near` | mainnet | Rhea swap venue |
| `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | mainnet | Native USDC |
| `https://1click.chaindefuser.com` | mainnet | NEAR Intents 1Click API |

## Architecture

```mermaid
flowchart LR
  T[Trader wallet] -->|buy, evaluation orders| C[tenor]
  C -->|list_prices| O[oracle]
  K[Keeper or anyone] -->|poke| C
  C -->|fund: create account, code, trade-only key| G[Guard on n.tenor]
  C -->|capital| G
  A[Trader key or agent] -->|place_order, close, payout| G
  G -->|list_prices| O
  G -->|ft_transfer_call| V[Venue: mock-swap or Rhea]
  G -->|delete key on breach| G
  G -->|remaining capital| C
```

**Why this venue:** `execute_intents` on `intents.near` only takes signed payloads, and a swap needs
a solver's offsetting signature obtained off-chain. A contract with no key can't do that without an
off-chain signer, so swaps go through Rhea, where the Guard's own `ft_transfer_call` is enough and
the DEX enforces `min_amount_out`. Intents handles the cross-chain edges.

The Guard also enforces a 1% slippage floor against the oracle, whatever the trader asks for, so a
trader can't route capital through a pool they control at a bad price.

## Trust assumptions

- **Price oracle.** Pyth's Hermes has required a paid API key since 2026-08-26, and `pyth-oracle.testnet` has been stale since June 2026. The testnet stack therefore reads `tenor-oracle`, which has Pyth's interface and is pushed by one keeper account using 1Click's public prices with a fixed 0.03% spread. **That keeper could post false prices.** A Pyth deployment needs only a different oracle account id.
- **OutLayer's oracle is not usable today.** `price-oracle.testnet` has none of Pyth's methods and no registered oracles.
- **Owner powers.** The owner can change pass rates (new sales only) and the oracle for evaluations and future Guards. A live Guard's oracle and rules are fixed at creation.
- **Contract upgrades.** `tenor` itself has an owner key while in development. Guards have no full-access key. On testnet the factory deploys Guard code it stores, because a global contract costs more testnet NEAR. The owner could change that code for future Guards but not existing ones, and each account’s code hash is public.
- **Mock assets.** On testnet, USDC and the market tokens are mocks with an open faucet, and `mock-swap` mints its output.
- **Keeper liveness.** A breach is only applied when someone calls `poke` or trades, so a dip between calls can go unseen.

## Limitations

- Spot, long or flat only. BTC, ETH, SOL and NEAR on testnet.
- On mainnet, Rhea only has deep USDC liquidity for NEAR (pool 4512), so real swaps would be NEAR only.
- With a 60-second price limit, a trader can act on information newer than the oracle. The spread and fee reduce this but don't remove it.
- Candle charts show public Coinbase market data for context. Fills use the onchain oracle, so there is no order book, and the two prices can differ slightly.
- Checkout from another chain is a dry-run quote only. Card payment, email login and coupons don't exist.
- Breach records link to the account and block rather than the exact transaction.
- Popup-free evaluation trading needs a wallet that supports testnet and function-call keys. Others prompt on each order.
- The trader key for a funded account lives in that browser's storage.
- Not audited.

## Tests

- `npm test`: shared vectors against the TypeScript rules.
- `cargo test --workspace`: 87 tests covering the fee table, rule ordering, shared vectors and contract panic paths.
- `scripts/build-wasm.sh` then `npm run wasm:optimize`: rebuilds and shrinks `wasm/`. The build needs `RUSTFLAGS='--cfg near'`, which the script sets.

## Prior work

A previous version of this concept exists on Arc (Circle's L1) at github.com/vishnudevs1/tenor. No
code was copied from it. This repository is a from-scratch rebuild for NEAR, started during the
hackathon window, and only this work should be judged.

## Libraries used

- Rust: `near-sdk`, `near-contract-standards`
- JS: `near-api-js`, `@hot-labs/near-connect`, `function-call-key-plugin`, `next`, `react`, `tailwindcss`, `three`, `motion`, `lightweight-charts`, `geist`, `dotenv`, `bs58`
- Tools: `near-sandbox`, `binaryen`
- Reference only: `@ref-finance/ref-sdk` (swap message format), `near/intents` (Verifier source)
- AI-generated code: parts of this repository were written with an AI coding assistant, as allowed by HACKATHON.md Q-005.

MIT licensed.
