use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const T0: u64 = 1_800_000_000;
const BTC: &str = "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

fn ctx(who: &str, deposit: u128) {
    testing_env!(VMContextBuilder::new()
        .current_account_id("tenor.near".parse().unwrap())
        .predecessor_account_id(who.parse().unwrap())
        .block_timestamp(T0 * 1_000_000_000)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .build());
}

fn tenor() -> Tenor {
    ctx("owner.near", 0);
    Tenor::new(TenorInit {
        owner: "owner.near".parse().unwrap(),
        treasury: "treasury.near".parse().unwrap(),
        usdc: "usdc.near".parse().unwrap(),
        oracle: "oracle.near".parse().unwrap(),
        venue: "swap.near".parse().unwrap(),
        venue_kind: VenueKind::MockSwap,
        markets: vec![MarketCfg {
            symbol: "BTC".into(),
            token: "btc.near".parse().unwrap(),
            pool_id: 0,
        }],
        guard_near_budget: NearToken::from_near(1),
        guard_code_hash: None,
        allow_demo_funding: true,
        key_allowance: NearToken::from_millinear(250),
    })
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

fn order(usdc: u128) -> EvalAction {
    EvalAction::Order { symbol: "BTC".into(), usdc: U128(usdc), tp_e8: None, sl_e8: None }
}

fn buy(t: &mut Tenor, who: &str, product: &str, amount: u128) -> U128 {
    ctx("usdc.near", 0);
    match t.ft_on_transfer(
        who.parse().unwrap(),
        U128(amount),
        json!({ "action": "buy", "product": product }).to_string(),
    ) {
        PromiseOrValue::Value(v) => v,
        _ => panic!("expected a value"),
    }
}

const USD: u128 = 1_000_000;
const PX: i64 = 100 * 100_000_000;

#[test]
fn buying_credits_the_reserve_and_refunds_the_excess() {
    let mut t = tenor();
    assert_eq!(buy(&mut t, "a.near", "classic-1-25000", 200 * USD).0, 20 * USD);
    assert_eq!(t.reserve_state().reserve.0, 180 * USD);
    assert_eq!(t.challenges_of("a.near".parse().unwrap()).len(), 1);
}

#[test]
#[should_panic(expected = "Payment is below the fee")]
fn underpaying_is_rejected() {
    let mut t = tenor();
    buy(&mut t, "a.near", "classic-1-25000", 179 * USD);
}

#[test]
#[should_panic(expected = "call claim_demo")]
fn demo_cannot_be_bought() {
    let mut t = tenor();
    buy(&mut t, "a.near", "demo", 0);
}

#[test]
#[should_panic(expected = "Unknown")]
fn unknown_product_is_rejected() {
    let mut t = tenor();
    buy(&mut t, "a.near", "gold-1-5000", 1);
}

#[test]
#[should_panic(expected = "Only USDC")]
fn other_tokens_are_rejected() {
    let mut t = tenor();
    ctx("fake.near", 0);
    let _ = t.ft_on_transfer("a.near".parse().unwrap(), U128(1), "{}".into());
}

#[test]
#[should_panic(expected = "Bad msg")]
fn bad_msg_is_rejected() {
    let mut t = tenor();
    ctx("usdc.near", 0);
    let _ = t.ft_on_transfer("a.near".parse().unwrap(), U128(1), "nope".into());
}

#[test]
#[should_panic(expected = "Over the 200K")]
fn active_paid_size_is_capped() {
    let mut t = tenor();
    buy(&mut t, "a.near", "classic-1-200000", 1440 * USD);
    buy(&mut t, "a.near", "classic-1-5000", 36 * USD);
}

#[test]
fn demo_is_free_once() {
    let mut t = tenor();
    ctx("a.near", 0);
    assert_eq!(t.claim_demo(), 1);
    assert_eq!(t.get_challenge(1).unwrap().initial_balance.0, 10_000 * USD);
}

#[test]
#[should_panic(expected = "Demo already claimed")]
fn demo_cannot_be_claimed_twice() {
    let mut t = tenor();
    ctx("a.near", 0);
    t.claim_demo();
    t.claim_demo();
}

#[test]
fn order_fills_with_fee_and_marks_at_bid() {
    let mut t = tenor();
    ctx("a.near", 0);
    let id = t.claim_demo();
    t.on_prices(id, order(1_000 * USD), prices(PX));
    let c = t.get_challenge(id).unwrap();
    assert_eq!(c.cash.0, 9_000 * USD);
    assert_eq!(c.positions[0].qty.0, 999_500_000);
    assert_eq!(c.last_equity.0, 9_999_500_000);
}

#[test]
fn two_orders_in_one_market_stay_separate_trades() {
    let mut t = tenor();
    ctx("a.near", 0);
    let id = t.claim_demo();
    t.on_prices(id, order(1_000 * USD), prices(PX));
    t.on_prices(id, order(500 * USD), prices(PX * 2));
    let c = t.get_challenge(id).unwrap();
    assert_eq!(c.positions.len(), 2);
    assert_eq!(c.positions[0].cost.0, 1_000 * USD);
    assert_eq!(c.positions[1].cost.0, 500 * USD);
    assert_eq!(c.cash.0, 8_500 * USD);
}

#[test]
fn closing_one_trade_leaves_the_other_open() {
    let mut t = tenor();
    ctx("a.near", 0);
    let id = t.claim_demo();
    t.on_prices(id, order(1_000 * USD), prices(PX));
    t.on_prices(id, order(500 * USD), prices(PX));
    let second = t.get_challenge(id).unwrap().positions[1].qty;
    t.on_prices(id, EvalAction::Close { symbol: "BTC".into(), qty: Some(second) }, prices(PX));
    let c = t.get_challenge(id).unwrap();
    assert_eq!(c.positions.len(), 1);
    assert_eq!(c.positions[0].cost.0, 1_000 * USD);

    t.on_prices(id, EvalAction::Close { symbol: "BTC".into(), qty: None }, prices(PX));
    assert!(t.get_challenge(id).unwrap().positions.is_empty());
}

#[test]
fn closing_a_trade_that_does_not_exist_changes_nothing() {
    let mut t = tenor();
    ctx("a.near", 0);
    let id = t.claim_demo();
    t.on_prices(id, order(1_000 * USD), prices(PX));
    t.on_prices(id, EvalAction::Close { symbol: "BTC".into(), qty: Some(U128(7)) }, prices(PX));
    assert_eq!(t.get_challenge(id).unwrap().positions.len(), 1);
}

#[test]
fn the_position_cap_counts_every_trade_in_the_market() {
    let mut t = tenor();
    ctx("a.near", 0);
    let id = t.claim_demo();
    t.on_prices(id, order(6_000 * USD), prices(PX));
    t.on_prices(id, order(4_500 * USD), prices(PX));
    assert_eq!(t.get_challenge(id).unwrap().positions.len(), 1);
}

#[test]
fn open_trades_are_capped() {
    let mut t = tenor();
    ctx("a.near", 0);
    let id = t.claim_demo();
    for _ in 0..21 {
        t.on_prices(id, order(10 * USD), prices(PX));
    }
    let c = t.get_challenge(id).unwrap();
    assert_eq!(c.positions.len(), 20);
    assert_eq!(c.cash.0, 9_800 * USD);
}

#[test]
fn each_trade_keeps_its_own_stop() {
    let mut t = tenor();
    ctx("a.near", 0);
    let id = t.claim_demo();
    let stop = EvalAction::Order { symbol: "BTC".into(), usdc: U128(1_000 * USD), tp_e8: None, sl_e8: Some(U128(95 * 100_000_000)) };
    t.on_prices(id, stop, prices(PX));
    t.on_prices(id, order(1_000 * USD), prices(PX));
    t.on_prices(id, EvalAction::Poke, prices(PX * 94 / 100));
    let c = t.get_challenge(id).unwrap();
    assert_eq!(c.positions.len(), 1);
    assert_eq!(c.positions[0].sl_e8, None);
}

#[test]
fn over_the_cap_order_is_rejected_without_a_fill() {
    let mut t = tenor();
    ctx("a.near", 0);
    let id = t.claim_demo();
    t.on_prices(id, order(10_001 * USD), prices(PX));
    assert!(t.get_challenge(id).unwrap().positions.is_empty());
}

#[test]
fn stale_price_means_no_fill_and_no_breach() {
    let mut t = tenor();
    ctx("a.near", 0);
    let id = t.claim_demo();
    t.on_prices(id, order(1_000 * USD), prices(PX));
    // A crash, but the price is 61s old.
    t.on_prices(id, EvalAction::Poke, prices_at(PX / 2, T0 as i64 - 61));
    let c = t.get_challenge(id).unwrap();
    assert_eq!(c.status, EvalStatus::Active);
    assert_eq!(c.positions.len(), 1);
}

#[test]
fn missing_oracle_result_changes_nothing() {
    let mut t = tenor();
    ctx("a.near", 0);
    let id = t.claim_demo();
    t.on_prices(id, order(1_000 * USD), Err(PromiseError::Failed));
    assert_eq!(t.get_challenge(id).unwrap().cash.0, 10_000 * USD);
}

#[test]
fn hitting_the_target_passes_and_closes() {
    let mut t = tenor();
    ctx("a.near", 0);
    let id = t.claim_demo();
    t.on_prices(id, order(10_000 * USD), prices(PX));
    t.on_prices(id, EvalAction::Poke, prices(PX * 111 / 100));
    let c = t.get_challenge(id).unwrap();
    assert_eq!(c.status, EvalStatus::Passed);
    assert!(c.positions.is_empty());
}

#[test]
fn losing_past_the_daily_limit_breaches_and_records() {
    let mut t = tenor();
    ctx("a.near", 0);
    let id = t.claim_demo();
    t.on_prices(id, order(10_000 * USD), prices(PX));
    t.on_prices(id, EvalAction::Poke, prices(PX * 96 / 100));
    let c = t.get_challenge(id).unwrap();
    assert_eq!(c.status, EvalStatus::Breached);
    assert_eq!(c.breach_reason.as_deref(), Some("daily_loss"));
    assert_eq!(t.list_breaches(0, 10).len(), 1);
}

#[test]
fn two_step_moves_to_phase_two_with_a_fresh_balance() {
    let mut t = tenor();
    buy(&mut t, "a.near", "classic-2-10000", 45 * USD);
    ctx("a.near", 0);
    t.on_prices(1, order(10_000 * USD), prices(PX));
    t.on_prices(1, EvalAction::Poke, prices(PX * 109 / 100));
    let c = t.get_challenge(1).unwrap();
    assert_eq!(c.phase, 2);
    assert_eq!(c.status, EvalStatus::Active);
    assert_eq!(c.cash.0, 10_000 * USD);
    assert!(c.positions.is_empty());
}

#[test]
fn stop_loss_runs_before_the_breach_check() {
    let mut t = tenor();
    ctx("a.near", 0);
    let id = t.claim_demo();
    let action = EvalAction::Order {
        symbol: "BTC".into(),
        usdc: U128(1_000 * USD),
        tp_e8: None,
        sl_e8: Some(U128((PX * 90 / 100) as u128)),
    };
    t.on_prices(id, action, prices(PX));
    t.on_prices(id, EvalAction::Poke, prices(PX * 80 / 100));
    let c = t.get_challenge(id).unwrap();
    assert!(c.positions.is_empty());
    assert_eq!(c.status, EvalStatus::Active);
}

#[test]
fn utc_rollover_resets_the_daily_baseline() {
    let mut t = tenor();
    ctx("a.near", 0);
    let id = t.claim_demo();
    let mut c = t.get_challenge(id).unwrap();
    c.day_key -= 1;
    c.day_start_equity = U128(11_000 * USD);
    t.challenges.insert(id, c);
    t.on_prices(id, EvalAction::Poke, prices(PX));
    let c = t.get_challenge(id).unwrap();
    assert_eq!(c.day_start_equity.0, 10_000 * USD);
    assert_eq!(c.status, EvalStatus::Active);
}

#[test]
#[should_panic(expected = "Only the challenge owner")]
fn strangers_cannot_trade() {
    let mut t = tenor();
    ctx("a.near", 0);
    let id = t.claim_demo();
    ctx("b.near", 0);
    let _ = t.place_order(id, "BTC".into(), U128(1), None, None);
}

#[test]
#[should_panic(expected = "Order size must be positive")]
fn zero_orders_are_rejected() {
    let mut t = tenor();
    ctx("a.near", 0);
    let id = t.claim_demo();
    let _ = t.place_order(id, "BTC".into(), U128(0), None, None);
}

#[test]
#[should_panic(expected = "Market not available")]
fn unknown_markets_are_rejected() {
    let mut t = tenor();
    ctx("a.near", 0);
    let id = t.claim_demo();
    let _ = t.place_order(id, "DOGE".into(), U128(1), None, None);
}

#[test]
#[should_panic(expected = "Challenge is not active")]
fn poke_rejects_finished_challenges() {
    let mut t = tenor();
    ctx("a.near", 0);
    let id = t.claim_demo();
    t.on_prices(id, order(10_000 * USD), prices(PX));
    t.on_prices(id, EvalAction::Poke, prices(PX * 96 / 100));
    let _ = t.poke(id.to_string());
}

#[test]
#[should_panic(expected = "Unknown Guard")]
fn poke_rejects_unknown_guards() {
    let mut t = tenor();
    let _ = t.poke("nobody.near".into());
}

fn passed(t: &mut Tenor) -> u64 {
    ctx("a.near", 0);
    let id = t.claim_demo();
    t.on_prices(id, order(10_000 * USD), prices(PX));
    t.on_prices(id, EvalAction::Poke, prices(PX * 111 / 100));
    id
}

fn pk() -> PublicKey {
    "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp".parse().unwrap()
}

fn deposit(t: &mut Tenor, action: &str, amount: u128) {
    ctx("usdc.near", 0);
    let _ = t.ft_on_transfer(
        "lp.near".parse().unwrap(),
        U128(amount),
        json!({ "action": action }).to_string(),
    );
}

#[test]
#[should_panic(expected = "Challenge has not passed")]
fn fund_needs_a_pass() {
    let mut t = tenor();
    ctx("a.near", 1_000_000_000_000_000_000_000_000);
    let id = t.claim_demo();
    ctx("a.near", 1_000_000_000_000_000_000_000_000);
    let _ = t.fund(id, pk());
}

#[test]
#[should_panic(expected = "Only the challenge owner")]
fn fund_is_owner_only() {
    let mut t = tenor();
    let id = passed(&mut t);
    ctx("b.near", 1_000_000_000_000_000_000_000_000);
    let _ = t.fund(id, pk());
}

#[test]
#[should_panic(expected = "Attach the Guard NEAR budget")]
fn fund_needs_the_near_budget() {
    let mut t = tenor();
    let id = passed(&mut t);
    ctx("a.near", 1);
    let _ = t.fund(id, pk());
}

#[test]
#[should_panic(expected = "Risk reserve does not cover")]
fn fund_panics_when_the_reserve_is_short() {
    let mut t = tenor();
    let id = passed(&mut t);
    // 10K Classic: max loss 750, so 900 is required.
    deposit(&mut t, "deposit_reserve", 900 * USD - 1);
    deposit(&mut t, "deposit_vault", 10_000 * USD);
    ctx("a.near", 1_000_000_000_000_000_000_000_000);
    let _ = t.fund(id, pk());
}

#[test]
#[should_panic(expected = "Capital vault is too small")]
fn fund_panics_when_the_vault_is_short() {
    let mut t = tenor();
    let id = passed(&mut t);
    deposit(&mut t, "deposit_reserve", 900 * USD);
    ctx("a.near", 1_000_000_000_000_000_000_000_000);
    let _ = t.fund(id, pk());
}

#[test]
fn set_pass_rates_changes_the_price() {
    let mut t = tenor();
    ctx("owner.near", 0);
    t.set_pass_rates(1_600, 500, "evidence".into());
    assert_eq!(t.quote_fee("classic-1-25000".into()).0, 360 * USD);
}

#[test]
#[should_panic(expected = "Pass rate out of range")]
fn pass_rate_is_bounded() {
    let mut t = tenor();
    ctx("owner.near", 0);
    t.set_pass_rates(0, 500, "x".into());
}

#[test]
#[should_panic(expected = "Only the owner")]
fn admin_is_owner_only() {
    let mut t = tenor();
    ctx("a.near", 0);
    t.set_oracle("evil.near".parse().unwrap());
}

#[test]
#[should_panic(expected = "Only a Guard")]
fn only_guards_can_report_breaches() {
    let mut t = tenor();
    ctx("a.near", 0);
    t.report_breach("daily_loss".into(), U128(1));
}

#[test]
#[should_panic(expected = "Only a Guard")]
fn only_guards_can_return_capital() {
    let mut t = tenor();
    deposit(&mut t, "guard_return", 1);
}

#[test]
fn catalog_lists_every_product() {
    let t = tenor();
    let catalog = t.get_catalog();
    assert_eq!(catalog.len(), 3 * 2 * 7);
    let e = catalog.iter().find(|e| e.product == "turbo-2-25000").unwrap();
    assert_eq!(e.fee.0, 57 * USD);
}
