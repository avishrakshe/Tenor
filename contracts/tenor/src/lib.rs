//! Tenor main contract.
//!
//! Evaluations are paper accounts in this contract's state, priced by the oracle, so every order
//! is a transaction and pass/fail needs no backend. `fund` deploys a Guard on a sub-account for
//! accounts that pass, and only if the risk reserve covers every live loss by 1.2x.

use near_sdk::json_types::{Base58CryptoHash, I64, U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::{IterableMap, LookupMap, LookupSet, Vector};
use near_sdk::{
    env, ext_contract, near, require, AccountId, Allowance, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseError, PromiseOrValue, PublicKey,
};
use std::collections::HashMap;
use tenor_rules as rules;

const GAS_ORACLE: Gas = Gas::from_tgas(15);
const GAS_ON_PRICES: Gas = Gas::from_tgas(60);
const GAS_GUARD_INIT: Gas = Gas::from_tgas(90);
const GAS_ON_CREATED: Gas = Gas::from_tgas(120);
const GAS_STORAGE: Gas = Gas::from_tgas(10);
const GAS_FT_CALL: Gas = Gas::from_tgas(70);
const GAS_ON_CAPITAL: Gas = Gas::from_tgas(15);
const GAS_POKE_OVERHEAD: Gas = Gas::from_tgas(5);

const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const FT_STORAGE: NearToken = NearToken::from_micronear(1_250);
/// Must match `guard::TRADER_METHODS`.
const TRADER_METHODS: &str = "place_order,close_position,request_payout";
const GUARD_CODE_KEY: &[u8] = b"GUARD_CODE";

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Challenges,
    ByOwner,
    DemoClaimed,
    ActivePaid,
    Funded,
    GuardIndex,
    Breaches,
}

#[derive(Clone)]
#[near(serializers = [json])]
pub struct Price {
    pub price: I64,
    pub conf: U64,
    pub expo: i32,
    pub publish_time: i64,
}

#[derive(Clone)]
#[near(serializers = [json, borsh])]
pub struct MarketCfg {
    pub symbol: String,
    pub token: AccountId,
    pub pool_id: u64,
}

#[derive(Clone, PartialEq, Debug)]
#[near(serializers = [json, borsh])]
pub enum EvalStatus {
    Active,
    Passed,
    Breached,
    /// `fund` is in flight.
    Funding,
    Funded,
}

#[derive(Clone)]
#[near(serializers = [json, borsh])]
pub struct PaperPosition {
    pub symbol: String,
    pub qty: U128,
    pub cost: U128,
    pub tp_e8: Option<U128>,
    pub sl_e8: Option<U128>,
}

#[derive(Clone)]
#[near(serializers = [json, borsh])]
pub struct Challenge {
    pub id: u64,
    pub owner: AccountId,
    pub product: String,
    pub phase: u8,
    pub status: EvalStatus,
    pub breach_reason: Option<String>,
    pub initial_balance: U128,
    pub cash: U128,
    pub positions: Vec<PaperPosition>,
    pub day_key: u64,
    pub day_start_equity: U128,
    pub last_equity: U128,
    pub fee_paid: U128,
    pub created_at: u64,
    pub guard: Option<AccountId>,
}

#[derive(Clone)]
#[near(serializers = [json, borsh])]
pub struct FundedAccount {
    pub guard: AccountId,
    pub challenge_id: u64,
    pub trader: AccountId,
    pub capital: U128,
    pub max_loss: U128,
    pub created_at: u64,
    pub settled: bool,
    pub returned: U128,
}

#[derive(Clone)]
#[near(serializers = [json, borsh])]
pub struct BreachRecord {
    /// A challenge id, or the Guard account for a funded account.
    pub account: String,
    pub funded: bool,
    pub reason: String,
    pub equity: U128,
    pub timestamp: u64,
    pub block_height: u64,
}

#[derive(Clone)]
#[near(serializers = [json, borsh])]
pub enum EvalAction {
    Order {
        symbol: String,
        usdc: U128,
        tp_e8: Option<U128>,
        sl_e8: Option<U128>,
    },
    Close {
        symbol: String,
    },
    Poke,
}

#[derive(Clone, PartialEq, Debug)]
#[near(serializers = [json, borsh])]
pub enum VenueKind {
    MockSwap,
    Rhea,
}

#[near(serializers = [json])]
pub struct TenorInit {
    pub owner: AccountId,
    pub treasury: AccountId,
    pub usdc: AccountId,
    pub oracle: AccountId,
    pub venue: AccountId,
    pub venue_kind: VenueKind,
    pub markets: Vec<MarketCfg>,
    pub guard_near_budget: NearToken,
    pub guard_code_hash: Option<Base58CryptoHash>,
    pub allow_demo_funding: bool,
    pub key_allowance: NearToken,
}

#[near(serializers = [json])]
pub struct ReserveState {
    pub reserve: U128,
    pub vault: U128,
    pub live_max_loss: U128,
    pub capital_deployed: U128,
    /// reserve / live_max_loss in bps, or `None` with nothing live.
    pub coverage_bps: Option<U128>,
    pub required_coverage_bps: U128,
}

#[near(serializers = [json])]
pub struct CatalogEntry {
    pub product: String,
    pub plan: String,
    pub two_step: bool,
    pub size_usdc: U128,
    pub fee: U128,
    pub max_loss: U128,
    pub target_bps: u32,
    pub phase_two_target_bps: Option<u32>,
    pub max_drawdown_bps: u32,
    pub daily_loss_bps: u32,
}

#[near(serializers = [json])]
pub struct PublicConfig {
    pub owner: AccountId,
    pub treasury: AccountId,
    pub usdc: AccountId,
    pub oracle: AccountId,
    pub venue: AccountId,
    pub venue_kind: VenueKind,
    pub markets: Vec<MarketCfg>,
    pub guard_near_budget: NearToken,
    pub guard_code_hash: Option<Base58CryptoHash>,
    pub allow_demo_funding: bool,
    pub pass_rate_one_step_bps: u32,
    pub pass_rate_two_step_bps: u32,
    pub pass_rate_evidence: String,
}

#[derive(serde_json_msg::Deserialize)]
#[serde(crate = "serde_json_msg")]
#[serde(tag = "action", rename_all = "snake_case")]
enum FtMsg {
    Buy { product: String },
    DepositReserve,
    DepositVault,
    GuardReturn,
}

use near_sdk::serde as serde_json_msg;

#[ext_contract(ext_oracle)]
pub trait Oracle {
    fn list_prices(&self, price_ids: Vec<String>) -> HashMap<String, Option<Price>>;
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Tenor {
    owner: AccountId,
    treasury: AccountId,
    usdc: AccountId,
    oracle: AccountId,
    venue: AccountId,
    venue_kind: VenueKind,
    markets: Vec<MarketCfg>,
    guard_near_budget: NearToken,
    guard_code_hash: Option<Base58CryptoHash>,
    allow_demo_funding: bool,
    key_allowance: NearToken,
    pass_rate_one_step_bps: u32,
    pass_rate_two_step_bps: u32,
    pass_rate_evidence: String,
    reserve: u128,
    vault: u128,
    live_max_loss: u128,
    capital_deployed: u128,
    next_challenge: u64,
    next_guard: u64,
    challenges: IterableMap<u64, Challenge>,
    by_owner: LookupMap<AccountId, Vec<u64>>,
    demo_claimed: LookupSet<AccountId>,
    active_paid_usdc: LookupMap<AccountId, u128>,
    funded: Vector<FundedAccount>,
    guard_index: LookupMap<AccountId, u32>,
    breaches: Vector<BreachRecord>,
}

fn event(name: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard":"tenor","version":"1.0.0","event":name,"data":[data]})
    ));
}

fn now_secs() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

fn rule<T>(r: rules::Result<T>) -> T {
    r.unwrap_or_else(|e| env::panic_str(&format!("Rules error: {e:?}")))
}

fn product_of(c: &Challenge) -> rules::Product {
    rule(rules::Product::parse(&c.product))
}

fn phase_of(c: &Challenge) -> rules::Phase {
    if c.phase == 2 {
        rules::Phase::Two
    } else {
        rules::Phase::One
    }
}

/// Liquidation value of the book plus cash.
fn equity_of(c: &Challenge, quotes: &HashMap<String, rules::Quote>) -> u128 {
    let mut equity = c.cash.0;
    for p in &c.positions {
        let m = rule(rules::market(&p.symbol));
        equity = equity
            .checked_add(rule(rules::mark_value(p.qty.0, &quotes[&p.symbol], m.decimals)))
            .unwrap_or_else(|| env::panic_str("Overflow"));
    }
    equity
}

fn close_all(c: &mut Challenge, quotes: &HashMap<String, rules::Quote>) {
    for p in std::mem::take(&mut c.positions) {
        let m = rule(rules::market(&p.symbol));
        let (out, _) = rule(rules::fill_sell(p.qty.0, &quotes[&p.symbol], m.decimals));
        c.cash = U128(c.cash.0 + out);
    }
}

fn sell_position(c: &mut Challenge, index: usize, quotes: &HashMap<String, rules::Quote>) {
    let p = c.positions.remove(index);
    let m = rule(rules::market(&p.symbol));
    let (out, _) = rule(rules::fill_sell(p.qty.0, &quotes[&p.symbol], m.decimals));
    c.cash = U128(c.cash.0 + out);
    event("eval_sold", json!({ "id": c.id, "symbol": p.symbol, "usdc": U128(out) }));
}

#[near]
impl Tenor {
    #[init]
    pub fn new(init: TenorInit) -> Self {
        for m in &init.markets {
            require!(rules::market(&m.symbol).is_ok(), "Unknown market");
        }
        Self {
            owner: init.owner,
            treasury: init.treasury,
            usdc: init.usdc,
            oracle: init.oracle,
            venue: init.venue,
            venue_kind: init.venue_kind,
            markets: init.markets,
            guard_near_budget: init.guard_near_budget,
            guard_code_hash: init.guard_code_hash,
            allow_demo_funding: init.allow_demo_funding,
            key_allowance: init.key_allowance,
            pass_rate_one_step_bps: rules::PASS_RATE_ONE_STEP_BPS,
            pass_rate_two_step_bps: rules::PASS_RATE_TWO_STEP_BPS,
            pass_rate_evidence: "seed".to_string(),
            reserve: 0,
            vault: 0,
            live_max_loss: 0,
            capital_deployed: 0,
            next_challenge: 1,
            next_guard: 1,
            challenges: IterableMap::new(StorageKey::Challenges),
            by_owner: LookupMap::new(StorageKey::ByOwner),
            demo_claimed: LookupSet::new(StorageKey::DemoClaimed),
            active_paid_usdc: LookupMap::new(StorageKey::ActivePaid),
            funded: Vector::new(StorageKey::Funded),
            guard_index: LookupMap::new(StorageKey::GuardIndex),
            breaches: Vector::new(StorageKey::Breaches),
        }
    }

    // ---- Admin ----------------------------------------------------------------------------

    pub fn set_pass_rates(&mut self, one_step_bps: u32, two_step_bps: u32, evidence_hash: String) {
        self.require_owner();
        require!(
            one_step_bps > 0 && one_step_bps <= 10_000 && two_step_bps > 0 && two_step_bps <= 10_000,
            "Pass rate out of range"
        );
        self.pass_rate_one_step_bps = one_step_bps;
        self.pass_rate_two_step_bps = two_step_bps;
        self.pass_rate_evidence = evidence_hash;
    }

    /// Switches the price source for evaluations and future Guards. Live Guards keep theirs.
    pub fn set_oracle(&mut self, oracle: AccountId) {
        self.require_owner();
        self.oracle = oracle;
    }

    /// Fallback when global contracts aren't used. The argument is the raw wasm as tx input.
    pub fn set_guard_code(&mut self) {
        self.require_owner();
        env::storage_write(GUARD_CODE_KEY, &env::input().expect("No input"));
    }

    // ---- Purchases and deposits -----------------------------------------------------------

    /// NEP-141 receiver. `msg` is JSON: `{"action":"buy","product":"classic-1-25000"}`,
    /// `{"action":"deposit_reserve"}`, `{"action":"deposit_vault"}` or `{"action":"guard_return"}`.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc, "Only USDC is accepted");
        let parsed: FtMsg =
            serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("Bad msg"));
        let unused = match parsed {
            FtMsg::Buy { product } => self.buy(sender_id, amount.0, &product),
            FtMsg::DepositReserve => {
                self.reserve += amount.0;
                event("reserve_deposit", json!({ "from": sender_id, "amount": amount }));
                0
            }
            FtMsg::DepositVault => {
                self.vault += amount.0;
                event("vault_deposit", json!({ "from": sender_id, "amount": amount }));
                0
            }
            FtMsg::GuardReturn => {
                self.guard_return(&sender_id, amount.0);
                0
            }
        };
        PromiseOrValue::Value(U128(unused))
    }

    /// One free 10K demo per account, so the product can be tried with no funds.
    pub fn claim_demo(&mut self) -> u64 {
        let owner = env::predecessor_account_id();
        require!(self.demo_claimed.insert(owner.clone()), "Demo already claimed");
        self.open_challenge(owner, "demo", 0)
    }

    // ---- Evaluation trading ---------------------------------------------------------------

    /// Spends `usdc` (fee included) buying `symbol`. Non-payable so a function-call key can sign.
    pub fn place_order(
        &mut self,
        challenge_id: u64,
        symbol: String,
        usdc: U128,
        tp_e8: Option<U128>,
        sl_e8: Option<U128>,
    ) -> Promise {
        self.require_active_owner(challenge_id);
        require!(usdc.0 > 0, "Order size must be positive");
        require!(rules::market(&symbol).is_ok(), "Market not available");
        self.fetch_prices(challenge_id, EvalAction::Order { symbol, usdc, tp_e8, sl_e8 })
    }

    pub fn close_position(&mut self, challenge_id: u64, symbol: String) -> Promise {
        self.require_active_owner(challenge_id);
        self.fetch_prices(challenge_id, EvalAction::Close { symbol })
    }

    /// Permissionless keeper entry point. `account` is a challenge id or a Guard account.
    pub fn poke(&mut self, account: String) -> Promise {
        if let Ok(id) = account.parse::<u64>() {
            let c = self.challenge(id);
            require!(c.status == EvalStatus::Active, "Challenge is not active");
            return self.fetch_prices(id, EvalAction::Poke);
        }
        let guard: AccountId = account.parse().unwrap_or_else(|_| env::panic_str("Bad account"));
        require!(self.guard_index.contains_key(&guard), "Unknown Guard");
        Promise::new(guard).function_call(
            "poke".to_string(),
            vec![b'{', b'}'],
            NearToken::from_yoctonear(0),
            env::prepaid_gas()
                .saturating_sub(env::used_gas())
                .saturating_sub(GAS_POKE_OVERHEAD),
        )
    }

    #[private]
    pub fn on_prices(
        &mut self,
        id: u64,
        action: EvalAction,
        #[callback_result] prices: Result<HashMap<String, Option<Price>>, PromiseError>,
    ) {
        let mut c = self.challenge(id);
        if c.status != EvalStatus::Active {
            return;
        }
        let Some(quotes) = prices.ok().and_then(|p| read_quotes(&c, &p, &action)) else {
            // No fresh price: no fills and no breaches.
            event("price_stale", json!({ "id": id }));
            return;
        };

        // 1. TP/SL.
        while let Some(i) = c.positions.iter().position(|p| {
            rules::trigger_hit(&quotes[&p.symbol], p.tp_e8.map(|v| v.0), p.sl_e8.map(|v| v.0))
        }) {
            sell_position(&mut c, i, &quotes);
        }

        // 2. UTC rollover.
        let today = rules::day_key(now_secs());
        if today != c.day_key {
            c.day_key = today;
            c.day_start_equity = U128(equity_of(&c, &quotes));
        }

        // 3 and 4. Breach, then pass.
        self.judge(&mut c, &quotes);

        // The order runs only on an account that is still active, then is judged too.
        if c.status == EvalStatus::Active {
            let acted = match action {
                EvalAction::Order { symbol, usdc, tp_e8, sl_e8 } => {
                    apply_order(&mut c, &symbol, usdc.0, tp_e8, sl_e8, &quotes)
                }
                EvalAction::Close { symbol } => {
                    match c.positions.iter().position(|p| p.symbol == symbol) {
                        Some(i) => {
                            sell_position(&mut c, i, &quotes);
                            true
                        }
                        None => {
                            event("order_rejected", json!({ "id": c.id, "reason": "no_position" }));
                            false
                        }
                    }
                }
                EvalAction::Poke => false,
            };
            if acted {
                self.judge(&mut c, &quotes);
            }
        }
        c.last_equity = U128(equity_of(&c, &quotes));
        self.challenges.insert(id, c);
    }

    // ---- Funding --------------------------------------------------------------------------

    /// Creates `<n>.<this contract>` with the Guard code and the trader's function-call key, and
    /// no full-access key. The attached NEAR becomes the Guard's own gas and storage budget.
    #[payable]
    pub fn fund(&mut self, challenge_id: u64, trader_public_key: PublicKey) -> Promise {
        let mut c = self.challenge(challenge_id);
        require!(env::predecessor_account_id() == c.owner, "Only the challenge owner");
        require!(c.status == EvalStatus::Passed, "Challenge has not passed");
        require!(env::attached_deposit() >= self.guard_near_budget, "Attach the Guard NEAR budget");
        let product = product_of(&c);
        require!(!product.demo || self.allow_demo_funding, "Demo accounts cannot be funded");

        let capital = c.initial_balance.0;
        let max_loss = rule(rules::max_loss(product.size_usdc, product.plan.max_drawdown_bps()));
        require!(
            rule(rules::reserve_covers(self.reserve, self.live_max_loss, max_loss)),
            "Risk reserve does not cover this account"
        );
        require!(self.vault >= capital, "Capital vault is too small");

        self.vault -= capital;
        self.capital_deployed += capital;
        self.live_max_loss += max_loss;
        c.status = EvalStatus::Funding;
        let trader = c.owner.clone();
        self.challenges.insert(challenge_id, c);

        let guard: AccountId = format!("{}.{}", self.next_guard, env::current_account_id())
            .parse()
            .unwrap_or_else(|_| env::panic_str("Bad Guard id"));
        self.next_guard += 1;

        let init = json!({ "init": {
            "tenor": env::current_account_id(),
            "trader": trader,
            "trader_public_key": trader_public_key,
            "treasury": self.treasury,
            "usdc": self.usdc,
            "oracle": self.oracle,
            "venue": self.venue,
            "venue_kind": self.venue_kind,
            "markets": self.markets,
            "initial_balance": U128(capital),
            "max_drawdown_bps": product.plan.max_drawdown_bps(),
            "daily_loss_bps": product.ruleset().daily_loss_bps,
            "key_allowance": self.key_allowance,
        }});

        let batch = Promise::new(guard.clone())
            .create_account()
            .transfer(env::attached_deposit());
        let batch = match self.guard_code_hash {
            Some(hash) => batch.use_global_contract(hash),
            None => batch.deploy_contract(
                env::storage_read(GUARD_CODE_KEY).expect("Guard code not set"),
            ),
        };
        batch
            .add_access_key_allowance(
                trader_public_key,
                Allowance::limited(self.key_allowance).unwrap(),
                guard.clone(),
                TRADER_METHODS.to_string(),
            )
            .function_call(
                "new".to_string(),
                init.to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_GUARD_INIT,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_CREATED).on_guard_created(
                challenge_id,
                guard,
                U128(capital),
                U128(max_loss),
                env::attached_deposit(),
            ))
    }

    #[private]
    pub fn on_guard_created(
        &mut self,
        challenge_id: u64,
        guard: AccountId,
        capital: U128,
        max_loss: U128,
        budget: NearToken,
        #[callback_result] created: Result<(), PromiseError>,
    ) -> PromiseOrValue<()> {
        if created.is_err() {
            self.undo_funding(challenge_id, capital.0, max_loss.0);
            let owner = self.challenge(challenge_id).owner;
            return PromiseOrValue::Promise(Promise::new(owner).transfer(budget));
        }
        let usdc = self.usdc.clone();
        Promise::new(usdc.clone())
            .function_call(
                "storage_deposit".to_string(),
                json!({ "account_id": guard, "registration_only": true }).to_string().into_bytes(),
                FT_STORAGE,
                GAS_STORAGE,
            )
            .then(Promise::new(usdc).function_call(
                "ft_transfer_call".to_string(),
                json!({ "receiver_id": guard, "amount": capital, "msg": "fund" })
                    .to_string()
                    .into_bytes(),
                ONE_YOCTO,
                GAS_FT_CALL,
            ))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_CAPITAL).on_capital_sent(
                challenge_id,
                guard,
                capital,
                max_loss,
            ))
            .into()
    }

    #[private]
    pub fn on_capital_sent(
        &mut self,
        challenge_id: u64,
        guard: AccountId,
        capital: U128,
        max_loss: U128,
        #[callback_result] used: Result<U128, PromiseError>,
    ) {
        if used.map_or(true, |u| u.0 != capital.0) {
            self.undo_funding(challenge_id, capital.0, max_loss.0);
            event("funding_failed", json!({ "id": challenge_id, "guard": guard }));
            return;
        }
        let mut c = self.challenge(challenge_id);
        c.status = EvalStatus::Funded;
        c.guard = Some(guard.clone());
        let trader = c.owner.clone();
        self.challenges.insert(challenge_id, c);
        self.guard_index.insert(guard.clone(), self.funded.len());
        self.funded.push(FundedAccount {
            guard: guard.clone(),
            challenge_id,
            trader,
            capital,
            max_loss,
            created_at: now_secs(),
            settled: false,
            returned: U128(0),
        });
        event("funded", json!({ "id": challenge_id, "guard": guard, "capital": capital }));
    }

    /// Guards report their breach here for the public record.
    pub fn report_breach(&mut self, reason: String, equity: U128) {
        let guard = env::predecessor_account_id();
        require!(self.guard_index.contains_key(&guard), "Only a Guard");
        self.record_breach(guard.to_string(), true, reason, equity.0);
    }

    // ---- Views ----------------------------------------------------------------------------

    pub fn get_config(&self) -> PublicConfig {
        PublicConfig {
            owner: self.owner.clone(),
            treasury: self.treasury.clone(),
            usdc: self.usdc.clone(),
            oracle: self.oracle.clone(),
            venue: self.venue.clone(),
            venue_kind: self.venue_kind.clone(),
            markets: self.markets.clone(),
            guard_near_budget: self.guard_near_budget,
            guard_code_hash: self.guard_code_hash,
            allow_demo_funding: self.allow_demo_funding,
            pass_rate_one_step_bps: self.pass_rate_one_step_bps,
            pass_rate_two_step_bps: self.pass_rate_two_step_bps,
            pass_rate_evidence: self.pass_rate_evidence.clone(),
        }
    }

    pub fn quote_fee(&self, product: String) -> U128 {
        U128(self.fee_for(&rule(rules::Product::parse(&product))))
    }

    pub fn get_catalog(&self) -> Vec<CatalogEntry> {
        let mut out = Vec::new();
        for plan in ["classic", "turbo", "pro"] {
            for steps in [1, 2] {
                let sizes = [rules::MICRO_SIZE_USDC].into_iter().chain(rules::SIZES_USDC);
                for size in sizes {
                    let id = format!("{plan}-{steps}-{size}");
                    let p = rule(rules::Product::parse(&id));
                    let r = p.ruleset();
                    out.push(CatalogEntry {
                        product: id,
                        plan: plan.to_string(),
                        two_step: p.two_step,
                        size_usdc: U128(size),
                        fee: U128(self.fee_for(&p)),
                        max_loss: U128(rule(rules::max_loss(size, r.max_drawdown_bps))),
                        target_bps: r.phase_one_target_bps,
                        phase_two_target_bps: r.phase_two_target_bps,
                        max_drawdown_bps: r.max_drawdown_bps,
                        daily_loss_bps: r.daily_loss_bps,
                    });
                }
            }
        }
        out
    }

    pub fn get_challenge(&self, id: u64) -> Option<Challenge> {
        self.challenges.get(&id).cloned()
    }

    pub fn challenges_of(&self, owner: AccountId) -> Vec<Challenge> {
        self.by_owner
            .get(&owner)
            .map(|ids| ids.iter().filter_map(|i| self.challenges.get(i).cloned()).collect())
            .unwrap_or_default()
    }

    pub fn active_challenge_ids(&self, from_index: u32, limit: u32) -> Vec<u64> {
        self.challenges
            .iter()
            .filter(|(_, c)| c.status == EvalStatus::Active)
            .skip(from_index as usize)
            .take(limit as usize)
            .map(|(id, _)| *id)
            .collect()
    }

    pub fn reserve_state(&self) -> ReserveState {
        ReserveState {
            reserve: U128(self.reserve),
            vault: U128(self.vault),
            live_max_loss: U128(self.live_max_loss),
            capital_deployed: U128(self.capital_deployed),
            coverage_bps: if self.live_max_loss == 0 {
                None
            } else {
                Some(U128(rule(rules::mul_div_floor(self.reserve, rules::BPS, self.live_max_loss))))
            },
            required_coverage_bps: U128(rules::RESERVE_COVERAGE_BPS),
        }
    }

    pub fn list_funded(&self, from_index: u32, limit: u32) -> Vec<FundedAccount> {
        self.funded.iter().skip(from_index as usize).take(limit as usize).cloned().collect()
    }

    pub fn list_breaches(&self, from_index: u32, limit: u32) -> Vec<BreachRecord> {
        self.breaches.iter().skip(from_index as usize).take(limit as usize).cloned().collect()
    }
}

impl Tenor {
    fn require_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
    }

    fn challenge(&self, id: u64) -> Challenge {
        self.challenges
            .get(&id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Unknown challenge"))
    }

    fn require_active_owner(&self, id: u64) {
        let c = self.challenge(id);
        require!(env::predecessor_account_id() == c.owner, "Only the challenge owner");
        require!(c.status == EvalStatus::Active, "Challenge is not active");
    }

    fn fee_for(&self, p: &rules::Product) -> u128 {
        if p.demo {
            return 0;
        }
        let rate = if p.two_step {
            self.pass_rate_two_step_bps
        } else {
            self.pass_rate_one_step_bps
        };
        rule(rules::challenge_fee(p.size_usdc, p.plan.max_drawdown_bps(), rate))
    }

    fn buy(&mut self, buyer: AccountId, amount: u128, product_id: &str) -> u128 {
        let p = rule(rules::Product::parse(product_id));
        require!(!p.demo, "The demo is free: call claim_demo");
        let fee = self.fee_for(&p);
        require!(amount >= fee, "Payment is below the fee");
        let active = self.active_paid_usdc.get(&buyer).copied().unwrap_or(0);
        require!(
            active + p.size_usdc <= rules::MAX_ACTIVE_PAID_USDC,
            "Over the 200K active evaluation limit"
        );
        self.active_paid_usdc.insert(buyer.clone(), active + p.size_usdc);
        self.reserve += fee;
        self.open_challenge(buyer, product_id, fee);
        amount - fee
    }

    fn open_challenge(&mut self, owner: AccountId, product_id: &str, fee: u128) -> u64 {
        let p = rule(rules::Product::parse(product_id));
        let initial = rule(p.initial_balance());
        let id = self.next_challenge;
        self.next_challenge += 1;
        self.challenges.insert(
            id,
            Challenge {
                id,
                owner: owner.clone(),
                product: product_id.to_string(),
                phase: 1,
                status: EvalStatus::Active,
                breach_reason: None,
                initial_balance: U128(initial),
                cash: U128(initial),
                positions: Vec::new(),
                day_key: rules::day_key(now_secs()),
                day_start_equity: U128(initial),
                last_equity: U128(initial),
                fee_paid: U128(fee),
                created_at: now_secs(),
                guard: None,
            },
        );
        let mut ids = self.by_owner.get(&owner).cloned().unwrap_or_default();
        ids.push(id);
        self.by_owner.insert(owner.clone(), ids);
        event("challenge_opened", json!({ "id": id, "owner": owner, "product": product_id }));
        id
    }

    fn fetch_prices(&self, id: u64, action: EvalAction) -> Promise {
        ext_oracle::ext(self.oracle.clone())
            .with_static_gas(GAS_ORACLE)
            .list_prices(
                self.markets
                    .iter()
                    .map(|m| rule(rules::market(&m.symbol)).feed_id.to_string())
                    .collect(),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_PRICES)
                    .on_prices(id, action),
            )
    }

    /// Applies breach and pass to the challenge, in that order.
    fn judge(&mut self, c: &mut Challenge, quotes: &HashMap<String, rules::Quote>) {
        let product = product_of(c);
        let equity = equity_of(c, quotes);
        let result = rule(rules::evaluate(
            &rules::Snapshot {
                phase: phase_of(c),
                initial_balance: c.initial_balance.0,
                day_start_equity: c.day_start_equity.0,
                equity,
            },
            &product.ruleset(),
        ));
        match result.status {
            rules::Status::Active => {}
            rules::Status::Breached => {
                let reason = result.reason.map(|r| r.as_str()).unwrap_or("unknown").to_string();
                close_all(c, quotes);
                c.status = EvalStatus::Breached;
                c.breach_reason = Some(reason.clone());
                self.release_active(c, &product);
                self.record_breach(c.id.to_string(), false, reason, equity);
            }
            rules::Status::AdvanceToPhaseTwo => {
                close_all(c, quotes);
                c.phase = 2;
                c.cash = c.initial_balance;
                c.day_start_equity = c.initial_balance;
                event("phase_two", json!({ "id": c.id }));
            }
            rules::Status::Passed => {
                close_all(c, quotes);
                c.status = EvalStatus::Passed;
                self.release_active(c, &product);
                event("passed", json!({ "id": c.id, "equity": U128(equity) }));
            }
        }
    }

    fn release_active(&mut self, c: &Challenge, product: &rules::Product) {
        if product.demo {
            return;
        }
        let active = self.active_paid_usdc.get(&c.owner).copied().unwrap_or(0);
        self.active_paid_usdc.insert(c.owner.clone(), active.saturating_sub(product.size_usdc));
    }

    fn record_breach(&mut self, account: String, funded: bool, reason: String, equity: u128) {
        event("breach", json!({ "account": account, "funded": funded, "reason": reason }));
        self.breaches.push(BreachRecord {
            account,
            funded,
            reason,
            equity: U128(equity),
            timestamp: now_secs(),
            block_height: env::block_height(),
        });
    }

    fn undo_funding(&mut self, id: u64, capital: u128, max_loss: u128) {
        self.vault += capital;
        self.capital_deployed -= capital;
        self.live_max_loss -= max_loss;
        let mut c = self.challenge(id);
        c.status = EvalStatus::Passed;
        self.challenges.insert(id, c);
    }

    /// Capital coming home. Any shortfall is paid from the reserve, which is what it's for.
    fn guard_return(&mut self, guard: &AccountId, amount: u128) {
        let index = *self
            .guard_index
            .get(guard)
            .unwrap_or_else(|| env::panic_str("Only a Guard"));
        let f = self.funded.get(index).cloned().unwrap();
        require!(!f.settled, "Already settled");
        let capital = f.capital.0;
        self.capital_deployed -= capital;
        self.live_max_loss -= f.max_loss.0;
        if amount >= capital {
            self.vault += capital;
            self.reserve += amount - capital;
        } else {
            let shortfall = capital - amount;
            let covered = shortfall.min(self.reserve);
            self.reserve -= covered;
            self.vault += amount + covered;
        }
        self.funded.replace(
            index,
            FundedAccount { settled: true, returned: U128(amount), ..f },
        );
        event("guard_settled", json!({ "guard": guard, "returned": U128(amount) }));
    }
}

fn read_quotes(
    c: &Challenge,
    prices: &HashMap<String, Option<Price>>,
    action: &EvalAction,
) -> Option<HashMap<String, rules::Quote>> {
    let mut needed: Vec<String> = c.positions.iter().map(|p| p.symbol.clone()).collect();
    if let EvalAction::Order { symbol, .. } = action {
        needed.push(symbol.clone());
    }
    let now = now_secs() as i64;
    let mut quotes = HashMap::new();
    for symbol in needed {
        let m = rules::market(&symbol).ok()?;
        let p = prices.get(m.feed_id)?.as_ref()?;
        if now.saturating_sub(p.publish_time) > rules::MAX_PRICE_AGE_SECS as i64 {
            return None;
        }
        quotes.insert(symbol, rules::normalize(p.price.0, p.conf.0, p.expo).ok()?);
    }
    Some(quotes)
}

/// Returns false (and logs why) if the order is outside the limits.
fn apply_order(
    c: &mut Challenge,
    symbol: &str,
    usdc: u128,
    tp_e8: Option<U128>,
    sl_e8: Option<U128>,
    quotes: &HashMap<String, rules::Quote>,
) -> bool {
    let m = rule(rules::market(symbol));
    let quote = &quotes[symbol];
    let equity = equity_of(c, quotes);
    let held = c.positions.iter().find(|p| p.symbol == symbol).map_or(0, |p| {
        rule(rules::mark_value(p.qty.0, quote, m.decimals))
    });
    let cap = rule(rules::notional_cap(equity, m));
    if usdc > c.cash.0 {
        event("order_rejected", json!({ "id": c.id, "reason": "insufficient_cash" }));
        return false;
    }
    if held.saturating_add(usdc) > cap {
        event("order_rejected", json!({ "id": c.id, "reason": "notional_cap", "cap": U128(cap) }));
        return false;
    }
    let (qty, _fee) = rule(rules::fill_buy(usdc, quote, m.decimals));
    c.cash = U128(c.cash.0 - usdc);
    match c.positions.iter_mut().find(|p| p.symbol == symbol) {
        Some(p) => {
            p.qty = U128(p.qty.0 + qty);
            p.cost = U128(p.cost.0 + usdc);
            p.tp_e8 = tp_e8.or(p.tp_e8);
            p.sl_e8 = sl_e8.or(p.sl_e8);
        }
        None => c.positions.push(PaperPosition {
            symbol: symbol.to_string(),
            qty: U128(qty),
            cost: U128(usdc),
            tp_e8,
            sl_e8,
        }),
    }
    event("eval_bought", json!({ "id": c.id, "symbol": symbol, "usdc": U128(usdc), "qty": U128(qty) }));
    true
}

#[cfg(test)]
mod tests;
