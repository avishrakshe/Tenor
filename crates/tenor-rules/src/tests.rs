use super::*;
use serde_json::Value;

fn vectors() -> Value {
    serde_json::from_str(include_str!("../../../test-vectors/rules.json")).unwrap()
}

fn big(v: &Value) -> u128 {
    v.as_str().unwrap().parse().unwrap()
}

#[test]
fn evaluate_matches_vectors() {
    for v in vectors()["evaluate"].as_array().unwrap() {
        let name = v["name"].as_str().unwrap();
        let phase = match v["phase"].as_str().unwrap() {
            "one" => Phase::One,
            "two" => Phase::Two,
            _ => Phase::Funded,
        };
        let plan = Plan::parse(v["plan"].as_str().unwrap()).unwrap();
        let ruleset = plan.ruleset(v["two_step"].as_bool().unwrap());
        let snap = Snapshot {
            phase,
            initial_balance: big(&v["initial"]),
            day_start_equity: big(&v["day_start"]),
            equity: big(&v["equity"]),
        };
        let e = evaluate(&snap, &ruleset).unwrap();
        let status = match e.status {
            Status::Active => "active",
            Status::Passed => "passed",
            Status::AdvanceToPhaseTwo => "advance",
            Status::Breached => "breached",
        };
        assert_eq!(status, v["status"].as_str().unwrap(), "{name}");
        assert_eq!(e.reason.map(|r| r.as_str()), v["reason"].as_str(), "{name}");
        assert_eq!(e.profit, big(&v["profit"]), "{name}");
        assert_eq!(e.daily_loss, big(&v["daily_loss"]), "{name}");
        assert_eq!(e.drawdown, big(&v["drawdown"]), "{name}");
        assert_eq!(
            e.target.map(|t| t.progress_bps as u64),
            v["target_bps"].as_u64(),
            "{name}"
        );
        assert_eq!(e.daily.progress_bps as u64, v["daily_bps"].as_u64().unwrap(), "{name}");
        assert_eq!(e.max_drawdown.progress_bps as u64, v["dd_bps"].as_u64().unwrap(), "{name}");
    }
}

#[test]
fn fills_match_vectors() {
    for v in vectors()["fills"].as_array().unwrap() {
        let name = v["name"].as_str().unwrap();
        let m = market(v["symbol"].as_str().unwrap()).unwrap();
        let q = normalize(
            v["price"].as_i64().unwrap(),
            v["conf"].as_u64().unwrap(),
            v["expo"].as_i64().unwrap() as i32,
        )
        .unwrap();
        let amount = big(&v["amount"]);
        let (out, fee) = if v["side"] == "buy" {
            fill_buy(amount, &q, m.decimals).unwrap()
        } else {
            fill_sell(amount, &q, m.decimals).unwrap()
        };
        assert_eq!(out, big(&v["out"]), "{name} out");
        assert_eq!(fee, big(&v["fee"]), "{name} fee");
    }
}

#[test]
fn fee_table_matches_spec() {
    let fees = vectors()["fees"].clone();
    for (key, row) in fees.as_object().unwrap() {
        let (plan, steps) = key.split_once('-').unwrap();
        let plan = Plan::parse(plan).unwrap();
        let pass_rate = if steps == "2" {
            PASS_RATE_TWO_STEP_BPS
        } else {
            PASS_RATE_ONE_STEP_BPS
        };
        for (size, expected) in SIZES_USDC.iter().zip(row.as_array().unwrap()) {
            let fee = challenge_fee(*size, plan.max_drawdown_bps(), pass_rate).unwrap();
            assert_eq!(
                fee,
                expected.as_u64().unwrap() as u128 * USDC_UNIT,
                "{key} size {size}"
            );
        }
    }
}

#[test]
fn fee_rounds_up_never_down() {
    // 5K Classic 2-step is 22.5 USDC before rounding.
    assert_eq!(challenge_fee(5_000, 600, 500).unwrap(), 23 * USDC_UNIT);
    // MICRO is 0.072 USDC before rounding.
    assert_eq!(challenge_fee(10, 600, 800).unwrap(), USDC_UNIT);
}

#[test]
fn max_loss_includes_gap_buffer() {
    assert_eq!(max_loss(25_000, 600).unwrap(), 1_875 * USDC_UNIT);
}

#[test]
fn reserve_needs_one_point_two_times_coverage() {
    let loss = 1_000 * USDC_UNIT;
    assert!(reserve_covers(1_200 * USDC_UNIT, 0, loss).unwrap());
    assert!(!reserve_covers(1_200 * USDC_UNIT - 1, 0, loss).unwrap());
    assert!(reserve_covers(2_400 * USDC_UNIT, loss, loss).unwrap());
    assert!(!reserve_covers(2_400 * USDC_UNIT - 1, loss, loss).unwrap());
}

#[test]
fn profit_split_is_exact() {
    assert_eq!(split_profit(1_000).unwrap(), (800, 200));
    assert_eq!(split_profit(3).unwrap(), (2, 1));
    let (t, f) = split_profit(123_456_789).unwrap();
    assert_eq!(t + f, 123_456_789);
}

#[test]
fn products_parse_or_reject() {
    assert_eq!(Product::parse("classic-1-25000").unwrap().size_usdc, 25_000);
    assert!(Product::parse("pro-2-200000").unwrap().two_step);
    assert_eq!(Product::parse("turbo-1-10").unwrap().size_usdc, MICRO_SIZE_USDC);
    assert!(Product::parse("demo").unwrap().demo);
    for bad in ["", "classic", "classic-3-5000", "classic-1-7777", "gold-1-5000", "pro-1-5000-x"] {
        assert_eq!(Product::parse(bad), Err(RulesError::UnknownProduct), "{bad}");
    }
}

#[test]
fn two_step_ruleset_uses_fixed_targets() {
    let r = Plan::Pro.ruleset(true);
    assert_eq!(r.phase_one_target_bps, 800);
    assert_eq!(r.phase_two_target_bps, Some(500));
    assert_eq!(r.max_drawdown_bps, 500);
    assert_eq!(r.daily_loss_bps, 300);
}

#[test]
fn normalize_rejects_bad_prices() {
    assert_eq!(normalize(0, 0, -8), Err(RulesError::InvalidPrice));
    assert_eq!(normalize(-1, 0, -8), Err(RulesError::InvalidPrice));
    assert_eq!(normalize(i64::MAX, 0, 40), Err(RulesError::Overflow));
}

#[test]
fn normalize_handles_all_exponents() {
    assert_eq!(normalize(100, 2, -8).unwrap(), Quote { price_e8: 100, conf_e8: 2 });
    assert_eq!(normalize(371, 1, -2).unwrap(), Quote { price_e8: 371_000_000, conf_e8: 1_000_000 });
    assert_eq!(normalize(1234, 1, -10).unwrap(), Quote { price_e8: 12, conf_e8: 1 });
}

#[test]
fn round_trip_loses_spread_and_fees() {
    let q = Quote { price_e8: 100 * 100_000_000, conf_e8: 3_000_000 };
    let (qty, _) = fill_buy(1_000 * USDC_UNIT, &q, 8).unwrap();
    let (back, _) = fill_sell(qty, &q, 8).unwrap();
    let loss = 1_000 * USDC_UNIT - back;
    // 0.05% fee and 0.03% conf on each side.
    assert!(loss > 1_500_000 && loss < 1_700_000, "{loss}");
}

#[test]
fn zero_amount_orders_are_rejected() {
    let q = Quote { price_e8: 1, conf_e8: 0 };
    assert_eq!(fill_buy(0, &q, 8), Err(RulesError::ZeroAmount));
    assert_eq!(fill_sell(0, &q, 8), Err(RulesError::ZeroAmount));
}

#[test]
fn market_table_has_caps() {
    assert_eq!(market("BTC").unwrap().cap_bps, 10_000);
    assert_eq!(market("SOL").unwrap().cap_bps, 5_000);
    assert_eq!(market("DOGE"), Err(RulesError::UnknownMarket));
    assert_eq!(notional_cap(1_000, market("NEAR").unwrap()).unwrap(), 500);
}

#[test]
fn triggers_use_the_bid() {
    let q = Quote { price_e8: 1_000, conf_e8: 10 };
    assert!(trigger_hit(&q, Some(990), None));
    assert!(!trigger_hit(&q, Some(991), None));
    assert!(trigger_hit(&q, None, Some(990)));
    assert!(!trigger_hit(&q, None, Some(989)));
    assert!(!trigger_hit(&q, None, None));
}

#[test]
fn day_key_rolls_at_utc_midnight() {
    assert_eq!(day_key(86_399), 0);
    assert_eq!(day_key(86_400), 1);
}
