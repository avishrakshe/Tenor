//! Tenor's rules engine. Pure integer math with no blockchain dependency, so the same code
//! judges paper evaluations (in `tenor`) and funded accounts (in `guard`).
//!
//! Units: USDC amounts are micro-USDC (6 decimals). Prices are normalised to USD x 1e8.
//! Basis points are 1/10_000.

pub const BPS: u128 = 10_000;
pub const USDC_UNIT: u128 = 1_000_000;
pub const SECONDS_PER_DAY: u64 = 86_400;
/// Taker fee on every fill: 0.05%.
pub const TAKER_FEE_BPS: u128 = 5;
/// Prices older than this never fill an order and never breach an account.
pub const MAX_PRICE_AGE_SECS: u64 = 60;
/// Trader's share of realised profit.
pub const TRADER_SHARE_BPS: u128 = 8_000;
/// Reserve must cover live max loss by this multiple (bps): 1.2x.
pub const RESERVE_COVERAGE_BPS: u128 = 12_000;
/// Gap buffer applied to a plan's drawdown when pricing and reserving: 1.25x.
pub const GAP_BUFFER_BPS: u128 = 12_500;
/// Maximum active paid evaluation size per trader, in whole USDC.
pub const MAX_ACTIVE_PAID_USDC: u128 = 200_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RulesError {
    Overflow,
    InvalidPrice,
    UnknownProduct,
    UnknownMarket,
    ZeroAmount,
}

pub type Result<T> = core::result::Result<T, RulesError>;

fn mul(a: u128, b: u128) -> Result<u128> {
    a.checked_mul(b).ok_or(RulesError::Overflow)
}

fn add(a: u128, b: u128) -> Result<u128> {
    a.checked_add(b).ok_or(RulesError::Overflow)
}

fn pow10(exp: u32) -> Result<u128> {
    10u128.checked_pow(exp).ok_or(RulesError::Overflow)
}

/// a * b / d, rounded down.
pub fn mul_div_floor(a: u128, b: u128, d: u128) -> Result<u128> {
    Ok(mul(a, b)? / d)
}

/// a * b / d, rounded up.
fn mul_div_ceil(a: u128, b: u128, d: u128) -> Result<u128> {
    Ok(add(mul(a, b)?, d - 1)? / d)
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    One,
    Two,
    Funded,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ruleset {
    pub phase_one_target_bps: u32,
    /// `None` for 1-step products.
    pub phase_two_target_bps: Option<u32>,
    pub max_drawdown_bps: u32,
    pub daily_loss_bps: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub phase: Phase,
    pub initial_balance: u128,
    pub day_start_equity: u128,
    pub equity: u128,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Active,
    /// Evaluation complete: the account can be funded.
    Passed,
    /// Phase 1 of a 2-step product complete: the account moves to phase 2.
    AdvanceToPhaseTwo,
    Breached,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BreachReason {
    DailyLoss,
    MaxDrawdown,
}

impl BreachReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            BreachReason::DailyLoss => "daily_loss",
            BreachReason::MaxDrawdown => "max_drawdown",
        }
    }
}

/// One UI meter. `progress_bps` is 0..=10_000.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Objective {
    pub progress_bps: u32,
    pub remaining: u128,
    pub limit: u128,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Evaluation {
    pub status: Status,
    pub reason: Option<BreachReason>,
    pub profit: u128,
    pub daily_loss: u128,
    pub drawdown: u128,
    pub target: Option<Objective>,
    pub daily: Objective,
    pub max_drawdown: Objective,
}

fn objective(used: u128, limit: u128) -> Result<Objective> {
    let capped = used.min(limit);
    let progress_bps = if limit == 0 {
        0
    } else {
        mul_div_floor(capped, BPS, limit)? as u32
    };
    Ok(Objective {
        progress_bps,
        remaining: limit - capped,
        limit,
    })
}

fn pct(amount: u128, bps: u32) -> Result<u128> {
    mul_div_floor(amount, bps as u128, BPS)
}

/// Breach checks run before the pass check, always: a tick that is both is a breach.
pub fn evaluate(s: &Snapshot, r: &Ruleset) -> Result<Evaluation> {
    let profit = s.equity.saturating_sub(s.initial_balance);
    let daily_loss = s.day_start_equity.saturating_sub(s.equity);
    let drawdown = s.initial_balance.saturating_sub(s.equity);

    let daily_limit = pct(s.initial_balance, r.daily_loss_bps)?;
    let dd_limit = pct(s.initial_balance, r.max_drawdown_bps)?;
    let target_bps = match s.phase {
        Phase::One => Some(r.phase_one_target_bps),
        Phase::Two => r.phase_two_target_bps,
        Phase::Funded => None,
    };
    let target_limit = match target_bps {
        Some(bps) => Some(pct(s.initial_balance, bps)?),
        None => None,
    };

    let (status, reason) = if daily_loss >= daily_limit {
        (Status::Breached, Some(BreachReason::DailyLoss))
    } else if drawdown >= dd_limit {
        (Status::Breached, Some(BreachReason::MaxDrawdown))
    } else {
        match target_limit {
            Some(limit) if profit >= limit => {
                if s.phase == Phase::One && r.phase_two_target_bps.is_some() {
                    (Status::AdvanceToPhaseTwo, None)
                } else {
                    (Status::Passed, None)
                }
            }
            _ => (Status::Active, None),
        }
    };

    Ok(Evaluation {
        status,
        reason,
        profit,
        daily_loss,
        drawdown,
        target: match target_limit {
            Some(limit) => Some(objective(profit, limit)?),
            None => None,
        },
        daily: objective(daily_loss, daily_limit)?,
        max_drawdown: objective(drawdown, dd_limit)?,
    })
}

/// UTC day number for a Unix timestamp in seconds.
pub fn day_key(unix_secs: u64) -> u64 {
    unix_secs / SECONDS_PER_DAY
}

// ---------------------------------------------------------------------------------------------
// Catalog and fees
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Plan {
    Classic,
    Turbo,
    Pro,
}

pub const SIZES_USDC: [u128; 6] = [5_000, 10_000, 25_000, 50_000, 100_000, 200_000];
pub const MICRO_SIZE_USDC: u128 = 10;
pub const DEMO_SIZE_USDC: u128 = 10_000;
pub const PASS_RATE_ONE_STEP_BPS: u32 = 800;
pub const PASS_RATE_TWO_STEP_BPS: u32 = 500;

impl Plan {
    pub fn parse(s: &str) -> Option<Plan> {
        match s {
            "classic" => Some(Plan::Classic),
            "turbo" => Some(Plan::Turbo),
            "pro" => Some(Plan::Pro),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Plan::Classic => "classic",
            Plan::Turbo => "turbo",
            Plan::Pro => "pro",
        }
    }

    pub fn one_step_target_bps(&self) -> u32 {
        match self {
            Plan::Classic => 1_000,
            Plan::Turbo => 900,
            Plan::Pro => 1_200,
        }
    }

    pub fn max_drawdown_bps(&self) -> u32 {
        match self {
            Plan::Classic => 600,
            Plan::Turbo => 300,
            Plan::Pro => 500,
        }
    }

    pub fn ruleset(&self, two_step: bool) -> Ruleset {
        Ruleset {
            phase_one_target_bps: if two_step { 800 } else { self.one_step_target_bps() },
            phase_two_target_bps: if two_step { Some(500) } else { None },
            max_drawdown_bps: self.max_drawdown_bps(),
            daily_loss_bps: 300,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Product {
    pub plan: Plan,
    pub two_step: bool,
    pub size_usdc: u128,
    pub demo: bool,
}

impl Product {
    /// Product ids: `classic-1-25000`, `turbo-2-5000`, `pro-1-10` (MICRO), `demo`.
    pub fn parse(id: &str) -> Result<Product> {
        if id == "demo" {
            return Ok(Product {
                plan: Plan::Classic,
                two_step: false,
                size_usdc: DEMO_SIZE_USDC,
                demo: true,
            });
        }
        let mut parts = id.split('-');
        let plan = parts
            .next()
            .and_then(Plan::parse)
            .ok_or(RulesError::UnknownProduct)?;
        let two_step = match parts.next() {
            Some("1") => false,
            Some("2") => true,
            _ => return Err(RulesError::UnknownProduct),
        };
        let size_usdc: u128 = parts
            .next()
            .and_then(|s| s.parse().ok())
            .ok_or(RulesError::UnknownProduct)?;
        if parts.next().is_some()
            || !(size_usdc == MICRO_SIZE_USDC || SIZES_USDC.contains(&size_usdc))
        {
            return Err(RulesError::UnknownProduct);
        }
        Ok(Product {
            plan,
            two_step,
            size_usdc,
            demo: false,
        })
    }

    pub fn ruleset(&self) -> Ruleset {
        self.plan.ruleset(self.two_step)
    }

    pub fn default_pass_rate_bps(&self) -> u32 {
        if self.two_step {
            PASS_RATE_TWO_STEP_BPS
        } else {
            PASS_RATE_ONE_STEP_BPS
        }
    }

    pub fn initial_balance(&self) -> Result<u128> {
        mul(self.size_usdc, USDC_UNIT)
    }
}

/// max_loss = size * max_dd * 1.25, in micro-USDC, rounded up.
pub fn max_loss(size_usdc: u128, max_drawdown_bps: u32) -> Result<u128> {
    let numerator = mul(mul(size_usdc, USDC_UNIT)?, max_drawdown_bps as u128)?;
    mul_div_ceil(numerator, GAP_BUFFER_BPS, BPS * BPS)
}

/// fee = ceil(pass_rate * max_loss * 1.2), in micro-USDC, rounded up to a whole USDC.
pub fn challenge_fee(size_usdc: u128, max_drawdown_bps: u32, pass_rate_bps: u32) -> Result<u128> {
    let numerator = mul(
        mul(
            mul(size_usdc, max_drawdown_bps as u128)?,
            pass_rate_bps as u128,
        )?,
        GAP_BUFFER_BPS * RESERVE_COVERAGE_BPS,
    )?;
    let denominator = BPS * BPS * BPS * BPS;
    let whole = add(numerator, denominator - 1)? / denominator;
    mul(whole, USDC_UNIT)
}

/// `fund()` is allowed only if reserve >= (live + new) * 1.2.
pub fn reserve_covers(reserve: u128, live_max_loss: u128, new_max_loss: u128) -> Result<bool> {
    let required = mul_div_ceil(add(live_max_loss, new_max_loss)?, RESERVE_COVERAGE_BPS, BPS)?;
    Ok(reserve >= required)
}

/// Splits realised profit into (trader, firm). Rounding favours the firm by at most one unit.
pub fn split_profit(profit: u128) -> Result<(u128, u128)> {
    let trader = mul_div_floor(profit, TRADER_SHARE_BPS, BPS)?;
    Ok((trader, profit - trader))
}

// ---------------------------------------------------------------------------------------------
// Markets and fills
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Market {
    pub symbol: &'static str,
    /// Decimals of the NEP-141 token that represents this market.
    pub decimals: u32,
    /// Max position notional as a fraction of equity (bps).
    pub cap_bps: u32,
    /// Pyth feed id (hex, no 0x). Source: hermes.pyth.network/v2/price_feeds.
    pub feed_id: &'static str,
}

/// The one table of tradable markets. Spot, long or flat only.
pub const MARKETS: [Market; 4] = [
    Market {
        symbol: "BTC",
        decimals: 8,
        cap_bps: 10_000,
        feed_id: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    },
    Market {
        symbol: "ETH",
        decimals: 18,
        cap_bps: 10_000,
        feed_id: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    },
    Market {
        symbol: "SOL",
        decimals: 9,
        cap_bps: 5_000,
        feed_id: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    },
    Market {
        symbol: "NEAR",
        decimals: 24,
        cap_bps: 5_000,
        feed_id: "c415de8d2eba7db216527dff4b60e8f3a5311c740dadb233e13e12547e226750",
    },
];

pub fn market(symbol: &str) -> Result<&'static Market> {
    MARKETS
        .iter()
        .find(|m| m.symbol == symbol)
        .ok_or(RulesError::UnknownMarket)
}

/// Oracle price normalised to USD x 1e8.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Quote {
    pub price_e8: u128,
    pub conf_e8: u128,
}

/// Converts a Pyth-style (price, conf, expo) into a `Quote`. Rejects non-positive prices.
pub fn normalize(price: i64, conf: u64, expo: i32) -> Result<Quote> {
    if price <= 0 {
        return Err(RulesError::InvalidPrice);
    }
    let shift = expo.checked_add(8).ok_or(RulesError::Overflow)?;
    let (p, c) = (price as u128, conf as u128);
    if shift >= 0 {
        let factor = pow10(shift as u32)?;
        Ok(Quote {
            price_e8: mul(p, factor)?,
            conf_e8: mul(c, factor)?,
        })
    } else {
        let factor = pow10(shift.unsigned_abs())?;
        Ok(Quote {
            price_e8: p / factor,
            // Confidence widens the spread, so it rounds up.
            conf_e8: add(c, factor - 1)? / factor,
        })
    }
}

impl Quote {
    pub fn ask(&self) -> u128 {
        self.price_e8.saturating_add(self.conf_e8)
    }

    pub fn bid(&self) -> u128 {
        self.price_e8.saturating_sub(self.conf_e8)
    }
}

/// micro-USDC value of `qty` token base units at `price_e8`, rounded down.
pub fn notional(qty: u128, price_e8: u128, decimals: u32) -> Result<u128> {
    mul_div_floor(qty, price_e8, pow10(decimals + 2)?)
}

/// Token base units bought for `usdc` at `price_e8`, rounded down.
pub fn qty_for_notional(usdc: u128, price_e8: u128, decimals: u32) -> Result<u128> {
    if price_e8 == 0 {
        return Err(RulesError::InvalidPrice);
    }
    mul_div_floor(usdc, pow10(decimals + 2)?, price_e8)
}

pub fn taker_fee(usdc: u128) -> Result<u128> {
    mul_div_ceil(usdc, TAKER_FEE_BPS, BPS)
}

/// Spends `usdc` (fee included) at the ask. Returns (qty, fee).
pub fn fill_buy(usdc: u128, quote: &Quote, decimals: u32) -> Result<(u128, u128)> {
    if usdc == 0 {
        return Err(RulesError::ZeroAmount);
    }
    let fee = taker_fee(usdc)?;
    let spend = usdc.checked_sub(fee).ok_or(RulesError::Overflow)?;
    Ok((qty_for_notional(spend, quote.ask(), decimals)?, fee))
}

/// Sells `qty` at the bid. Returns (usdc received, fee).
pub fn fill_sell(qty: u128, quote: &Quote, decimals: u32) -> Result<(u128, u128)> {
    if qty == 0 {
        return Err(RulesError::ZeroAmount);
    }
    let gross = notional(qty, quote.bid(), decimals)?;
    let fee = taker_fee(gross)?;
    Ok((gross.saturating_sub(fee), fee))
}

/// Liquidation mark for equity: the bid, before the taker fee.
pub fn mark_value(qty: u128, quote: &Quote, decimals: u32) -> Result<u128> {
    notional(qty, quote.bid(), decimals)
}

/// Max position notional allowed for a market at `equity`.
pub fn notional_cap(equity: u128, m: &Market) -> Result<u128> {
    pct(equity, m.cap_bps)
}

/// True when a long position's take-profit or stop-loss is hit at this quote.
pub fn trigger_hit(quote: &Quote, tp_e8: Option<u128>, sl_e8: Option<u128>) -> bool {
    let bid = quote.bid();
    tp_e8.map_or(false, |tp| bid >= tp) || sl_e8.map_or(false, |sl| bid <= sl)
}

#[cfg(test)]
mod tests;
