use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;

const T0: u64 = 1_800_000_000;
const BTC: &str = "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const USD: u128 = 1_000_000;
const PX: i64 = 100 * 100_000_000;
const ME: &str = "1.tenor.near";
const CAPITAL: u128 = 10_000 * USD;

fn wallet(who: &str) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(ME.parse().unwrap())
        .predecessor_account_id(who.parse().unwrap())
        .block_timestamp(T0 * 1_000_000_000)
        .attached_deposit(NearToken::from_yoctonear(1))
        .build());
}

fn ctx(who: &str) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(ME.parse().unwrap())
        .predecessor_account_id(who.parse().unwrap())
        .block_timestamp(T0 * 1_000_000_000)
        .build());
}

fn pk() -> PublicKey {
    "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp".parse().unwrap()
}

fn init() -> GuardInit {
    GuardInit {
        tenor: "tenor.near".parse().unwrap(),
        trader: "trader.near".parse().unwrap(),
        trader_public_key: pk(),
        treasury: "treasury.near".parse().unwrap(),
        usdc: "usdc.near".parse().unwrap(),
        oracle: "oracle.near".parse().unwrap(),
        venue: "swap.near".parse().unwrap(),
        venue_kind: VenueKind::MockSwap,
        markets: vec![MarketCfg {
            symbol: "BTC".into(),
            token: "btc.near".parse().unwrap(),
            pool_id: 7,
        }],
        initial_balance: U128(CAPITAL),
        max_drawdown_bps: 600,
        daily_loss_bps: 300,
        key_allowance: NearToken::from_millinear(250),
    }
}

fn guard() -> Guard {
    ctx("tenor.near");
    let mut g = Guard::new(init());
    ctx("usdc.near");
    let _ = g.ft_on_transfer("tenor.near".parse().unwrap(), U128(CAPITAL), "fund".into());
    g
}

fn prices(price: i64) -> Result<HashMap<String, Option<Price>>, PromiseError> {
    prices_at(price, T0 as i64)
}

fn prices_at(price: i64, t: i64) -> Result<HashMap<String, Option<Price>>, PromiseError> {
    let mut m = HashMap::new();
    m.insert(
        BTC.to_string(),
        Some(Price { price: I64(price), conf: U64(0), expo: -8, publish_time: t }),
    );
    Ok(m)
}

fn order(usdc: u128) -> Action {
    Action::Order { symbol: "BTC".into(), usdc: U128(usdc), min_out: U128(0), tp_e8: None, sl_e8: None }
}

fn hold(g: &mut Guard, qty: u128) {
    g.positions.push(Position {
        symbol: "BTC".into(),
        qty: U128(qty),
        cost: U128(0),
        tp_e8: None,
        sl_e8: None,
    });
}

fn logged(name: &str) -> bool {
    get_logs().iter().any(|l| l.contains(&format!("\"event\":\"{name}\"")))
}

#[test]
#[should_panic(expected = "Only the factory")]
fn only_the_factory_can_init() {
    ctx("stranger.near");
    Guard::new(init());
}

#[test]
#[should_panic(expected = "Unknown market")]
fn init_rejects_unknown_markets() {
    ctx("tenor.near");
    let mut i = init();
    i.markets[0].symbol = "DOGE".into();
    Guard::new(i);
}

#[test]
fn capital_must_come_from_tenor_in_full() {
    ctx("tenor.near");
    let mut g = Guard::new(init());
    ctx("usdc.near");
    let wrong_amount = g.ft_on_transfer("tenor.near".parse().unwrap(), U128(1), "".into());
    assert!(matches!(wrong_amount, PromiseOrValue::Value(U128(1))));
    let wrong_sender = g.ft_on_transfer("x.near".parse().unwrap(), U128(CAPITAL), "".into());
    assert!(matches!(wrong_sender, PromiseOrValue::Value(U128(CAPITAL))));
    ctx("fake.near");
    let wrong_token = g.ft_on_transfer("tenor.near".parse().unwrap(), U128(CAPITAL), "".into());
    assert!(matches!(wrong_token, PromiseOrValue::Value(U128(CAPITAL))));
    assert_eq!(g.get_state().status, GuardStatus::Pending);
}

#[test]
#[should_panic(expected = "Only the trader key")]
fn only_the_trader_key_can_order() {
    let mut g = guard();
    ctx("trader.near");
    let _ = g.place_order("BTC".into(), U128(1), None, None, None);
}

#[test]
#[should_panic(expected = "Only the trader key")]
fn only_the_trader_key_can_close() {
    let mut g = guard();
    ctx("trader.near");
    let _ = g.close_position(None, None);
}

#[test]
#[should_panic(expected = "Only the trader key")]
fn only_the_trader_key_can_request_payout() {
    let mut g = guard();
    ctx("trader.near");
    let _ = g.request_payout("trader.near".parse().unwrap());
}

#[test]
#[should_panic(expected = "Recipient is not approved")]
fn agent_key_cannot_pay_a_stranger() {
    let mut g = guard();
    g.cash = CAPITAL + 1_000 * USD;
    ctx(ME);
    let _ = g.request_payout("attacker.near".parse().unwrap());
}

#[test]
#[should_panic(expected = "Only the trader's own wallet")]
fn agent_key_cannot_approve_a_recipient() {
    let mut g = guard();
    wallet(ME);
    g.approve_payout_recipient("attacker.near".parse().unwrap());
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn approval_needs_a_full_wallet_signature() {
    let mut g = guard();
    ctx("trader.near");
    g.approve_payout_recipient("friend.near".parse().unwrap());
}

#[test]
fn approved_recipient_can_be_paid_until_revoked() {
    let mut g = guard();
    wallet("trader.near");
    g.approve_payout_recipient("friend.near".parse().unwrap());
    assert_eq!(g.get_state().approved_recipients.len(), 1);
    g.cash = CAPITAL + 1_000 * USD;
    g.day_start_equity = g.cash;
    ctx(ME);
    let _ = g.request_payout("friend.near".parse().unwrap());
    assert_eq!(g.get_state().paid_to_trader.0, 800 * USD);
    wallet("trader.near");
    g.revoke_payout_recipient("friend.near".parse().unwrap());
    assert!(g.get_state().approved_recipients.is_empty());
}

#[test]
#[should_panic(expected = "Too many approved recipients")]
fn approved_list_is_capped() {
    let mut g = guard();
    wallet("trader.near");
    for i in 0..9 {
        g.approve_payout_recipient(format!("r{i}.near").parse().unwrap());
    }
}

#[test]
#[should_panic(expected = "Account is not active")]
fn pending_accounts_cannot_trade() {
    ctx("tenor.near");
    let mut g = Guard::new(init());
    ctx(ME);
    let _ = g.place_order("BTC".into(), U128(1), None, None, None);
}

#[test]
#[should_panic(expected = "Order size must be positive")]
fn zero_orders_are_rejected() {
    let mut g = guard();
    ctx(ME);
    let _ = g.place_order("BTC".into(), U128(0), None, None, None);
}

#[test]
#[should_panic(expected = "Not enough cash")]
fn orders_cannot_exceed_cash() {
    let mut g = guard();
    ctx(ME);
    let _ = g.place_order("BTC".into(), U128(CAPITAL + 1), None, None, None);
}

#[test]
#[should_panic(expected = "Market not available")]
fn unknown_markets_are_rejected() {
    let mut g = guard();
    ctx(ME);
    let _ = g.place_order("ETH".into(), U128(1), None, None, None);
}

#[test]
#[should_panic(expected = "Another action is in progress")]
fn one_action_at_a_time() {
    let mut g = guard();
    ctx(ME);
    let _ = g.place_order("BTC".into(), U128(1), None, None, None);
    let _ = g.place_order("BTC".into(), U128(1), None, None, None);
}

#[test]
#[should_panic(expected = "No profit to pay out")]
fn payout_needs_profit() {
    let mut g = guard();
    ctx(ME);
    let _ = g.request_payout("trader.near".parse().unwrap());
}

#[test]
#[should_panic(expected = "Close all positions first")]
fn payout_needs_a_flat_account() {
    let mut g = guard();
    hold(&mut g, 1);
    ctx(ME);
    let _ = g.request_payout("trader.near".parse().unwrap());
}

#[test]
fn payout_splits_80_20_and_protects_the_daily_baseline() {
    let mut g = guard();
    g.cash = CAPITAL + 1_000 * USD;
    g.day_start_equity = g.cash;
    ctx(ME);
    let _ = g.request_payout("trader.near".parse().unwrap());
    let s = g.get_state();
    assert_eq!(s.paid_to_trader.0, 800 * USD);
    assert_eq!(s.paid_to_firm.0, 200 * USD);
    assert_eq!(s.cash.0, CAPITAL);
    assert_eq!(s.day_start_equity.0, CAPITAL);
}

#[test]
fn payout_cannot_outrun_an_unpoked_breach() {
    let mut g = guard();
    g.cash = CAPITAL + 500 * USD;
    g.day_start_equity = CAPITAL + 1_000 * USD; // Down 500 today: past the 300 daily limit.
    ctx(ME);
    let _ = g.request_payout("trader.near".parse().unwrap());
    let s = g.get_state();
    assert_eq!(s.status, GuardStatus::Settled);
    assert_eq!(s.breach_reason.as_deref(), Some("daily_loss"));
    assert_eq!(s.paid_to_trader.0, 0);
}

#[test]
fn failed_trader_leg_restores_only_its_share() {
    let mut g = guard();
    g.cash = CAPITAL + 1_000 * USD;
    g.day_start_equity = g.cash;
    ctx(ME);
    let _ = g.request_payout("trader.near".parse().unwrap());
    let _ = g.on_trader_paid(U128(800 * USD), U128(200 * USD), false, Err(PromiseError::Failed));
    assert_eq!(g.get_state().cash.0, CAPITAL + 800 * USD);
    assert_eq!(g.get_state().paid_to_trader.0, 0);
    assert_eq!(g.get_state().paid_to_firm.0, 200 * USD);
}

#[test]
fn over_cap_order_is_rejected_and_unlocks() {
    // SOL is capped at 50% of equity, so 5_001 of 10_000 is one dollar too many.
    let mut g = guard();
    g.markets.push(MarketCfg { symbol: "SOL".into(), token: "sol.near".parse().unwrap(), pool_id: 8 });
    ctx(ME);
    let usdc = 5_001 * USD;
    let _ = g.place_order("SOL".into(), U128(usdc), None, None, None);
    let mut quotes = prices(PX).unwrap();
    quotes.insert(
        rules::market("SOL").unwrap().feed_id.to_string(),
        Some(Price { price: I64(PX), conf: U64(0), expo: -8, publish_time: T0 as i64 }),
    );
    let action = Action::Order { symbol: "SOL".into(), usdc: U128(usdc), min_out: U128(0), tp_e8: None, sl_e8: None };
    g.on_prices(action, Ok(quotes));
    assert!(logged("order_rejected"));
    assert!(g.get_state().positions.is_empty());
    assert!(!g.get_state().locked);
}

#[test]
fn stale_prices_mean_no_fill_and_no_breach() {
    let mut g = guard();
    hold(&mut g, CAPITAL);
    g.cash = 0;
    g.locked_at_ns = Some(1);
    ctx("anyone.near");
    g.on_prices(Action::Poke, prices_at(PX / 2, T0 as i64 - 61));
    assert!(logged("price_stale"));
    assert_eq!(g.get_state().status, GuardStatus::Active);
    assert!(!g.get_state().locked);
}

#[test]
fn a_failed_oracle_call_changes_nothing() {
    let mut g = guard();
    g.locked_at_ns = Some(1);
    g.on_prices(Action::Poke, Err(PromiseError::Failed));
    assert_eq!(g.get_state().status, GuardStatus::Active);
    assert!(!g.get_state().locked);
}

#[test]
fn a_loss_past_the_limit_breaches() {
    let mut g = guard();
    // 10K of BTC at 100 is 100 BTC with 8 decimals.
    hold(&mut g, 10_000_000_000);
    g.cash = 0;
    g.locked_at_ns = Some(1);
    g.on_prices(Action::Poke, prices(PX * 96 / 100));
    let s = g.get_state();
    assert_eq!(s.status, GuardStatus::Breached);
    assert_eq!(s.breach_reason.as_deref(), Some("daily_loss"));
    assert!(logged("breach"));
}

#[test]
fn profit_never_passes_a_funded_account() {
    let mut g = guard();
    hold(&mut g, 10_000_000_000);
    g.cash = 0;
    g.locked_at_ns = Some(1);
    g.on_prices(Action::Poke, prices(PX * 2));
    assert_eq!(g.get_state().status, GuardStatus::Active);
}

#[test]
fn rollover_resets_the_baseline() {
    let mut g = guard();
    g.day_key -= 1;
    g.day_start_equity = 11_000 * USD;
    g.locked_at_ns = Some(1);
    g.on_prices(Action::Poke, prices(PX));
    assert_eq!(g.get_state().day_start_equity.0, CAPITAL);
    assert_eq!(g.get_state().status, GuardStatus::Active);
}

#[test]
fn venue_rejection_keeps_the_book_and_unlocks() {
    let mut g = guard();
    g.locked_at_ns = Some(1);
    let _ = g.on_swap(
        "usdc.near".parse().unwrap(),
        "btc.near".parse().unwrap(),
        "BTC".into(),
        None,
        None,
        U128(5),
        Ok(U128(0)),
    );
    assert!(logged("order_rejected_by_venue"));
    assert_eq!(g.get_state().cash.0, CAPITAL);
    assert!(!g.get_state().locked);
}

#[test]
fn balances_rebuild_the_book_after_a_buy() {
    let mut g = guard();
    g.locked_at_ns = Some(1);
    g.on_balances(
        "usdc.near".parse().unwrap(),
        "BTC".into(),
        None,
        None,
        U128(1_000 * USD),
        Ok(U128(9_000 * USD)),
        Ok(U128(77)),
    );
    let s = g.get_state();
    assert_eq!(s.cash.0, 9_000 * USD);
    assert_eq!(s.positions[0].qty.0, 77);
    assert!(!s.locked);
}

#[test]
fn a_failed_balance_read_stays_locked_for_reconcile() {
    let mut g = guard();
    g.locked_at_ns = Some(1);
    g.on_balances(
        "usdc.near".parse().unwrap(),
        "BTC".into(),
        None,
        None,
        U128(1),
        Err(PromiseError::Failed),
        Ok(U128(77)),
    );
    assert!(g.get_state().locked);
    assert_eq!(g.get_state().cash.0, CAPITAL);
}

#[test]
#[should_panic(expected = "Nothing to do")]
fn poke_stops_after_settlement() {
    let mut g = guard();
    g.status = GuardStatus::Settled;
    let _ = g.poke();
}

#[test]
#[should_panic(expected = "Refreshed too recently")]
fn refresh_key_is_rate_limited() {
    let mut g = guard();
    let _ = g.refresh_key();
    let _ = g.refresh_key();
}

#[test]
#[should_panic(expected = "Account is not active")]
fn refresh_key_needs_an_active_account() {
    let mut g = guard();
    g.status = GuardStatus::Breached;
    let _ = g.refresh_key();
}

#[test]
fn rhea_msg_carries_pool_and_min_out() {
    let msg = VenueKind::Rhea.swap_msg(&SwapParams {
        token_in: "a.near",
        token_out: "b.near",
        pool_id: 4512,
        min_amount_out: 99,
    });
    let v: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(&msg).unwrap();
    assert_eq!(v["force"], 0);
    assert_eq!(v["actions"][0]["pool_id"], 4512);
    assert_eq!(v["actions"][0]["min_amount_out"], "99");
}

#[test]
fn slippage_floor_is_one_percent() {
    ctx(ME);
    assert_eq!(Guard::slippage_floor(10_000), 9_900);
}
