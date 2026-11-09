//! A funded account. The Guard is deployed on its own sub-account with no full-access key. The
//! trader signs with a function-call key on this account limited to `place_order`,
//! `close_position` and `request_payout`, so those calls have predecessor == this account.
//!
//! Function-call keys: https://docs.near.org/protocol/accounts-contracts/access-keys

mod venue;

use near_sdk::json_types::{I64, U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{
    assert_one_yocto, env, ext_contract, near, require, AccountId, Allowance, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError, PromiseOrValue, PublicKey,
};
use std::collections::HashMap;
use tenor_rules as rules;
use venue::{SwapParams, Venue, VenueKind};

const GAS_ORACLE: Gas = Gas::from_tgas(15);
const GAS_ON_PRICES: Gas = Gas::from_tgas(265);
const GAS_SWAP: Gas = Gas::from_tgas(170);
const GAS_ON_SWAP: Gas = Gas::from_tgas(60);
const GAS_BALANCE: Gas = Gas::from_tgas(5);
const GAS_ON_BALANCES: Gas = Gas::from_tgas(15);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_FT_RETURN: Gas = Gas::from_tgas(60);
const GAS_ON_RETURNED: Gas = Gas::from_tgas(8);
const GAS_ON_FIRM_PAID: Gas = Gas::from_tgas(75);
const GAS_ON_TRADER_PAID: Gas = Gas::from_tgas(95);
const GAS_STORAGE: Gas = Gas::from_tgas(10);
const GAS_REPORT: Gas = Gas::from_tgas(10);

const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
/// NEP-145 registration on a NEP-141 token.
const FT_STORAGE: NearToken = NearToken::from_micronear(1_250);
const VENUE_STORAGE: NearToken = NearToken::from_millinear(100);
/// A stuck in-flight action can be cleared after this long.
const LOCK_TTL_NS: u64 = 300 * 1_000_000_000;
const REFRESH_INTERVAL_NS: u64 = 60 * 1_000_000_000;
const MAX_APPROVED_RECIPIENTS: usize = 8;
/// Orders may not fill worse than this against the oracle, whatever the trader asks for. This
/// stops a trader routing capital through a pool they control at a terrible price.
const MAX_SLIPPAGE_BPS: u128 = 100;
pub const TRADER_METHODS: &str = "place_order,close_position,request_payout";

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
    /// Pool on the venue. Fixed at funding, never chosen by the trader.
    pub pool_id: u64,
}

#[near(serializers = [json])]
pub struct GuardInit {
    pub tenor: AccountId,
    pub trader: AccountId,
    pub trader_public_key: PublicKey,
    pub treasury: AccountId,
    pub usdc: AccountId,
    pub oracle: AccountId,
    pub venue: AccountId,
    pub venue_kind: VenueKind,
    pub markets: Vec<MarketCfg>,
    pub initial_balance: U128,
    pub max_drawdown_bps: u32,
    pub daily_loss_bps: u32,
    pub key_allowance: NearToken,
}

#[derive(Clone, PartialEq, Debug)]
#[near(serializers = [json, borsh])]
pub enum GuardStatus {
    /// Deployed, waiting for capital.
    Pending,
    Active,
    /// The trader ended the account; open positions are being sold.
    Closing,
    Breached,
    /// Capital is back at `tenor`.
    Settled,
}

#[derive(Clone)]
#[near(serializers = [json, borsh])]
pub struct Position {
    pub symbol: String,
    pub qty: U128,
    pub cost: U128,
    pub tp_e8: Option<U128>,
    pub sl_e8: Option<U128>,
}

#[derive(Clone)]
#[near(serializers = [json, borsh])]
pub enum Action {
    Order {
        symbol: String,
        usdc: U128,
        min_out: U128,
        tp_e8: Option<U128>,
        sl_e8: Option<U128>,
    },
    Close {
        symbol: Option<String>,
        end_account: bool,
    },
    Poke,
}

#[near(serializers = [json])]
pub struct GuardView {
    pub status: GuardStatus,
    pub breach_reason: Option<String>,
    pub tenor: AccountId,
    pub trader: AccountId,
    pub trader_public_key: PublicKey,
    pub venue: AccountId,
    pub venue_kind: VenueKind,
    pub oracle: AccountId,
    pub initial_balance: U128,
    pub cash: U128,
    pub positions: Vec<Position>,
    pub day_key: u64,
    pub day_start_equity: U128,
    pub max_drawdown_bps: u32,
    pub daily_loss_bps: u32,
    pub locked: bool,
    pub paid_to_trader: U128,
    pub paid_to_firm: U128,
    pub firm_owed: U128,
    pub markets: Vec<MarketCfg>,
    pub approved_recipients: Vec<AccountId>,
}

#[ext_contract(ext_oracle)]
pub trait Oracle {
    fn list_prices(&self, price_ids: Vec<String>) -> HashMap<String, Option<Price>>;
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Guard {
    tenor: AccountId,
    trader: AccountId,
    trader_public_key: PublicKey,
    treasury: AccountId,
    usdc: AccountId,
    oracle: AccountId,
    venue: AccountId,
    venue_kind: VenueKind,
    markets: Vec<MarketCfg>,
    initial_balance: u128,
    max_drawdown_bps: u32,
    daily_loss_bps: u32,
    status: GuardStatus,
    breach_reason: Option<String>,
    cash: u128,
    positions: Vec<Position>,
    day_key: u64,
    day_start_equity: u128,
    locked_at_ns: Option<u64>,
    last_refresh_ns: u64,
    key_allowance: NearToken,
    paid_to_trader: u128,
    paid_to_firm: u128,
    /// The firm's share of an earlier payout that failed to send. It sits in `cash` but is not
    /// profit, so it must never be split again.
    firm_owed: u128,
    approved_recipients: Vec<AccountId>,
}

fn event(name: &str, data: near_sdk::serde_json::Value) {
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

fn ft_call(token: &AccountId, method: &str, args: near_sdk::serde_json::Value, gas: Gas) -> Promise {
    Promise::new(token.clone()).function_call(
        method.to_string(),
        args.to_string().into_bytes(),
        ONE_YOCTO,
        gas,
    )
}

fn ft_balance(token: &AccountId, account: AccountId) -> Promise {
    Promise::new(token.clone()).function_call(
        "ft_balance_of".to_string(),
        json!({ "account_id": account }).to_string().into_bytes(),
        NearToken::from_yoctonear(0),
        GAS_BALANCE,
    )
}

fn storage_deposit(token: &AccountId, account: &AccountId, amount: NearToken) -> Promise {
    Promise::new(token.clone()).function_call(
        "storage_deposit".to_string(),
        json!({ "account_id": account, "registration_only": true })
            .to_string()
            .into_bytes(),
        amount,
        GAS_STORAGE,
    )
}

#[near]
impl Guard {
    /// Called by `tenor` in the same batch that creates this account, so it can't be front-run.
    #[init]
    pub fn new(init: GuardInit) -> Self {
        let parent = format!(".{}", env::predecessor_account_id());
        require!(
            env::current_account_id().as_str().ends_with(&parent)
                && env::predecessor_account_id() == init.tenor,
            "Only the factory can initialize a Guard"
        );
        for m in &init.markets {
            require!(rules::market(&m.symbol).is_ok(), "Unknown market");
        }
        let me = env::current_account_id();
        for m in &init.markets {
            let _ = storage_deposit(&m.token, &me, FT_STORAGE);
        }
        if init.venue_kind == VenueKind::Rhea {
            let _ = storage_deposit(&init.venue, &me, VENUE_STORAGE);
        }
        Self {
            tenor: init.tenor,
            trader: init.trader,
            trader_public_key: init.trader_public_key,
            treasury: init.treasury,
            usdc: init.usdc,
            oracle: init.oracle,
            venue: init.venue,
            venue_kind: init.venue_kind,
            markets: init.markets,
            initial_balance: init.initial_balance.0,
            max_drawdown_bps: init.max_drawdown_bps,
            daily_loss_bps: init.daily_loss_bps,
            status: GuardStatus::Pending,
            breach_reason: None,
            cash: 0,
            positions: Vec::new(),
            day_key: rules::day_key(now_secs()),
            day_start_equity: init.initial_balance.0,
            locked_at_ns: None,
            last_refresh_ns: 0,
            key_allowance: init.key_allowance,
            paid_to_trader: 0,
            paid_to_firm: 0,
            firm_owed: 0,
            approved_recipients: Vec::new(),
        }
    }

    /// Only `tenor` can activate the account, by sending exactly the agreed capital.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let _ = msg;
        if env::predecessor_account_id() == self.usdc
            && sender_id == self.tenor
            && self.status == GuardStatus::Pending
            && amount.0 == self.initial_balance
        {
            self.cash = amount.0;
            self.status = GuardStatus::Active;
            event("activated", json!({ "capital": amount }));
            return PromiseOrValue::Value(U128(0));
        }
        PromiseOrValue::Value(amount)
    }

    /// Spends `usdc` (fee included) buying `symbol`.
    pub fn place_order(
        &mut self,
        symbol: String,
        usdc: U128,
        min_out: Option<U128>,
        tp_e8: Option<U128>,
        sl_e8: Option<U128>,
    ) -> Promise {
        self.require_trader();
        require!(self.status == GuardStatus::Active, "Account is not active");
        require!(usdc.0 > 0, "Order size must be positive");
        require!(usdc.0 <= self.cash, "Not enough cash");
        require!(self.market_cfg(&symbol).is_some(), "Market not available");
        self.start(Action::Order {
            symbol,
            usdc,
            min_out: min_out.unwrap_or(U128(0)),
            tp_e8,
            sl_e8,
        })
    }

    /// Sells one position, or the next open position when `symbol` is `None`. With
    /// `end_account` the account closes for good once flat and the capital goes back to `tenor`.
    pub fn close_position(&mut self, symbol: Option<String>, end_account: Option<bool>) -> Promise {
        self.require_trader();
        require!(self.status == GuardStatus::Active, "Account is not active");
        self.start(Action::Close {
            symbol,
            end_account: end_account.unwrap_or(false),
        })
    }

    /// Lets the trader's own wallet add a payout address. The key on this account signs as the
    /// Guard, not as the trader, so an agent holding that key can never approve anything.
    #[payable]
    pub fn approve_payout_recipient(&mut self, recipient: AccountId) {
        assert_one_yocto();
        self.require_owner_wallet();
        require!(
            self.approved_recipients.len() < MAX_APPROVED_RECIPIENTS,
            "Too many approved recipients"
        );
        if !self.approved_recipients.contains(&recipient) {
            event("recipient_approved", json!({ "recipient": recipient }));
            self.approved_recipients.push(recipient);
        }
    }

    #[payable]
    pub fn revoke_payout_recipient(&mut self, recipient: AccountId) {
        assert_one_yocto();
        self.require_owner_wallet();
        self.approved_recipients.retain(|r| *r != recipient);
        event("recipient_revoked", json!({ "recipient": recipient }));
    }

    /// Pays realised profit 80/20 to the trader's own account or an address their wallet
    /// approved. Needs a flat account, so it never depends on a price.
    pub fn request_payout(&mut self, recipient: AccountId) -> Promise {
        self.require_trader();
        require!(
            recipient == self.trader || self.approved_recipients.contains(&recipient),
            "Recipient is not approved by the trader's wallet"
        );
        require!(self.status == GuardStatus::Active, "Account is not active");
        self.require_unlocked();
        require!(self.positions.is_empty(), "Close all positions first");
        // Flat, so equity is known without a price. A breach that nobody has poked yet must not
        // be able to pay out first.
        let today = rules::day_key(now_secs());
        if today != self.day_key {
            self.day_key = today;
            self.day_start_equity = self.cash;
        }
        if let Some(reason) = self.flat_breach_reason() {
            self.breach(reason, self.cash);
            return self.settle();
        }
        let profit = self.payable_profit();
        require!(profit > 0, "No profit to pay out");
        let (trader, firm) = rule(rules::split_profit(profit));
        self.pay(recipient, trader, firm + self.firm_owed, false)
    }

    /// Permissionless: applies TP/SL, UTC rollover and breaches, and advances liquidation.
    pub fn poke(&mut self) -> Promise {
        require!(
            matches!(
                self.status,
                GuardStatus::Active | GuardStatus::Closing | GuardStatus::Breached
            ),
            "Nothing to do"
        );
        // Before the flat check, or a stuck lock on a closing account could never be cleared.
        if let Some(at) = self.locked_at_ns {
            if env::block_timestamp().saturating_sub(at) > LOCK_TTL_NS {
                return self.reconcile();
            }
        }
        if self.is_flat_and_finishing() {
            self.require_unlocked();
            return self.settle();
        }
        self.start(Action::Poke)
    }

    /// Permissionless: restores the trader key's gas allowance. An allowance can't be raised in
    /// place, so the key is deleted and re-added with the same public key.
    pub fn refresh_key(&mut self) -> Promise {
        require!(self.status == GuardStatus::Active, "Account is not active");
        require!(
            env::block_timestamp().saturating_sub(self.last_refresh_ns) >= REFRESH_INTERVAL_NS,
            "Refreshed too recently"
        );
        self.last_refresh_ns = env::block_timestamp();
        Promise::new(env::current_account_id())
            .delete_key(self.trader_public_key.clone())
            .add_access_key_allowance(
                self.trader_public_key.clone(),
                Allowance::limited(self.key_allowance).unwrap(),
                env::current_account_id(),
                TRADER_METHODS.to_string(),
            )
    }

    #[private]
    pub fn on_prices(
        &mut self,
        action: Action,
        #[callback_result] prices: Result<HashMap<String, Option<Price>>, PromiseError>,
    ) {
        let quotes = prices.ok().and_then(|p| self.read_quotes(&p, &action));
        let Some(quotes) = quotes else {
            // No fresh price: no fills and no breaches.
            self.locked_at_ns = None;
            event("price_stale", json!({}));
            return;
        };
        let equity = self.equity(&quotes);

        // 1. TP/SL.
        if self.status == GuardStatus::Active {
            let hit = self.positions.iter().find(|p| {
                quotes.get(&p.symbol).map_or(false, |q| {
                    rules::trigger_hit(q, p.tp_e8.map(|v| v.0), p.sl_e8.map(|v| v.0))
                })
            });
            if let Some(p) = hit.cloned() {
                event("trigger_hit", json!({ "symbol": p.symbol }));
                self.swap_sell(&p, &quotes);
                return;
            }
        }

        // 2. UTC rollover.
        let today = rules::day_key(now_secs());
        if today != self.day_key {
            self.day_key = today;
            self.day_start_equity = equity;
        }

        // 3. Breach. The same `evaluate` that judged the evaluation judges this account.
        if self.status == GuardStatus::Active {
            let result = rule(rules::evaluate(
                &rules::Snapshot {
                    phase: rules::Phase::Funded,
                    initial_balance: self.initial_balance,
                    day_start_equity: self.day_start_equity,
                    equity,
                },
                &self.ruleset(),
            ));
            if let Some(reason) = result.reason {
                self.breach(reason.as_str(), equity);
                self.continue_liquidation(&quotes);
                return;
            }
        }

        match action {
            _ if self.status != GuardStatus::Active => self.continue_liquidation(&quotes),
            Action::Order { symbol, usdc, min_out, tp_e8, sl_e8 } => {
                self.execute_order(symbol, usdc.0, min_out.0, tp_e8, sl_e8, equity, &quotes)
            }
            Action::Close { symbol, end_account } => {
                if end_account {
                    self.status = GuardStatus::Closing;
                }
                let target = self
                    .positions
                    .iter()
                    .find(|p| symbol.as_ref().map_or(true, |s| *s == p.symbol))
                    .cloned();
                match target {
                    Some(p) => self.swap_sell(&p, &quotes),
                    None if end_account => {
                        self.locked_at_ns = None;
                        let _ = self.settle();
                    }
                    None => {
                        self.locked_at_ns = None;
                        event("nothing_to_close", json!({}));
                    }
                }
            }
            Action::Poke => self.locked_at_ns = None,
        }
    }

    #[private]
    pub fn on_swap(
        &mut self,
        token_in: AccountId,
        token_out: AccountId,
        symbol: String,
        tp_e8: Option<U128>,
        sl_e8: Option<U128>,
        spent: U128,
        #[callback_result] used: Result<U128, PromiseError>,
    ) -> PromiseOrValue<()> {
        if used.map_or(true, |u| u.0 == 0) {
            self.locked_at_ns = None;
            event("order_rejected_by_venue", json!({ "symbol": symbol }));
            return PromiseOrValue::Value(());
        }
        // Whatever the venue claims, the book is rebuilt from the token contracts' balances.
        let me = env::current_account_id();
        ft_balance(&token_in, me.clone())
            .and(ft_balance(&token_out, me.clone()))
            .then(
                Self::ext(me)
                    .with_static_gas(GAS_ON_BALANCES)
                    .on_balances(token_in, symbol, tp_e8, sl_e8, spent),
            )
            .into()
    }

    #[private]
    pub fn on_balances(
        &mut self,
        token_in: AccountId,
        symbol: String,
        tp_e8: Option<U128>,
        sl_e8: Option<U128>,
        spent: U128,
        #[callback_result] in_balance: Result<U128, PromiseError>,
        #[callback_result] out_balance: Result<U128, PromiseError>,
    ) {
        let (Ok(in_balance), Ok(out_balance)) = (in_balance, out_balance) else {
            // Stays locked so `poke` re-reads every balance after the TTL.
            event("balance_read_failed", json!({ "symbol": symbol }));
            return;
        };
        self.locked_at_ns = None;
        let bought = token_in == self.usdc;
        let (usdc_balance, qty) = if bought {
            (in_balance.0, out_balance.0)
        } else {
            (out_balance.0, in_balance.0)
        };
        self.cash = usdc_balance;
        self.apply_position(&symbol, qty, if bought { spent.0 } else { 0 }, tp_e8, sl_e8);
        event(
            "filled",
            json!({ "symbol": symbol, "side": if bought { "buy" } else { "sell" }, "cash": U128(self.cash), "qty": U128(qty) }),
        );
    }

    #[private]
    pub fn on_reconciled(&mut self, #[callback_vec] balances: Vec<U128>) {
        self.locked_at_ns = None;
        self.cash = balances[0].0;
        let symbols: Vec<String> = self.markets.iter().map(|m| m.symbol.clone()).collect();
        for (i, symbol) in symbols.iter().enumerate() {
            self.apply_position(symbol, balances[i + 1].0, 0, None, None);
        }
        event("reconciled", json!({ "cash": U128(self.cash) }));
    }

    #[private]
    pub fn on_trader_paid(
        &mut self,
        trader_amount: U128,
        firm_amount: U128,
        settle_after: bool,
        #[callback_result] paid: Result<(), PromiseError>,
    ) -> PromiseOrValue<()> {
        if paid.is_err() {
            // Pay nobody, so a retry splits the same profit 80/20. A closing account stays
            // Closing and flat, so `poke` tries again.
            self.locked_at_ns = None;
            self.restore_payout(trader_amount.0 + firm_amount.0);
            self.paid_to_trader -= trader_amount.0;
            self.paid_to_firm -= firm_amount.0;
            event("payout_failed", json!({ "leg": "trader" }));
            return PromiseOrValue::Value(());
        }
        ft_call(
            &self.usdc.clone(),
            "ft_transfer",
            json!({ "receiver_id": self.treasury, "amount": firm_amount }),
            GAS_FT_TRANSFER,
        )
        .then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_ON_FIRM_PAID)
                .on_firm_paid(trader_amount, firm_amount, settle_after),
        )
        .into()
    }

    #[private]
    pub fn on_firm_paid(
        &mut self,
        trader_amount: U128,
        firm_amount: U128,
        settle_after: bool,
        #[callback_result] paid: Result<(), PromiseError>,
    ) -> PromiseOrValue<()> {
        self.locked_at_ns = None;
        if paid.is_err() {
            self.restore_payout(firm_amount.0);
            self.paid_to_firm -= firm_amount.0;
            self.firm_owed = firm_amount.0;
            event("payout_failed", json!({ "leg": "firm" }));
        } else {
            self.firm_owed = 0;
            event("payout", json!({ "trader": trader_amount, "firm": firm_amount }));
        }
        if settle_after {
            return PromiseOrValue::Promise(self.return_capital());
        }
        PromiseOrValue::Value(())
    }

    /// `ft_transfer_call` refunds a failed return to this account, so anything not accepted goes
    /// back on the book and the account reopens for `poke` instead of stranding the money.
    #[private]
    pub fn on_capital_returned(
        &mut self,
        amount: U128,
        prior: GuardStatus,
        #[callback_result] used: Result<U128, PromiseError>,
    ) {
        let returned = used.map_or(0, |u| u.0);
        if returned >= amount.0 {
            event("settled", json!({ "returned": amount }));
            return;
        }
        self.cash = amount.0 - returned;
        self.status = prior;
        event("settle_failed", json!({ "amount": amount, "returned": U128(returned) }));
    }

    pub fn get_state(&self) -> GuardView {
        GuardView {
            status: self.status.clone(),
            breach_reason: self.breach_reason.clone(),
            tenor: self.tenor.clone(),
            trader: self.trader.clone(),
            trader_public_key: self.trader_public_key.clone(),
            venue: self.venue.clone(),
            venue_kind: self.venue_kind.clone(),
            oracle: self.oracle.clone(),
            initial_balance: U128(self.initial_balance),
            cash: U128(self.cash),
            positions: self.positions.clone(),
            day_key: self.day_key,
            day_start_equity: U128(self.day_start_equity),
            max_drawdown_bps: self.max_drawdown_bps,
            daily_loss_bps: self.daily_loss_bps,
            locked: self.locked_at_ns.is_some(),
            paid_to_trader: U128(self.paid_to_trader),
            paid_to_firm: U128(self.paid_to_firm),
            firm_owed: U128(self.firm_owed),
            markets: self.markets.clone(),
            approved_recipients: self.approved_recipients.clone(),
        }
    }
}

impl Guard {
    fn require_trader(&self) {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Only the trader key on this account"
        );
    }

    fn require_owner_wallet(&self) {
        require!(
            env::predecessor_account_id() == self.trader,
            "Only the trader's own wallet"
        );
    }

    /// Cash above the capital line that is really the trader's and firm's to split.
    fn payable_profit(&self) -> u128 {
        self.cash.saturating_sub(self.initial_balance + self.firm_owed)
    }

    fn flat_breach_reason(&self) -> Option<&'static str> {
        let result = rule(rules::evaluate(
            &rules::Snapshot {
                phase: rules::Phase::Funded,
                initial_balance: self.initial_balance,
                day_start_equity: self.day_start_equity,
                equity: self.cash,
            },
            &self.ruleset(),
        ));
        result.reason.map(|r| r.as_str())
    }

    fn ruleset(&self) -> rules::Ruleset {
        rules::Ruleset {
            phase_one_target_bps: 0,
            phase_two_target_bps: None,
            max_drawdown_bps: self.max_drawdown_bps,
            daily_loss_bps: self.daily_loss_bps,
        }
    }

    fn require_unlocked(&self) {
        require!(self.locked_at_ns.is_none(), "Another action is in progress");
    }

    fn start(&mut self, action: Action) -> Promise {
        self.require_unlocked();
        self.locked_at_ns = Some(env::block_timestamp());
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
                    .on_prices(action),
            )
    }

    fn market_cfg(&self, symbol: &str) -> Option<&MarketCfg> {
        self.markets.iter().find(|m| m.symbol == symbol)
    }

    fn is_flat_and_finishing(&self) -> bool {
        self.positions.is_empty()
            && matches!(self.status, GuardStatus::Closing | GuardStatus::Breached)
    }

    /// Fresh quotes for every open position plus the order's market, or `None` if any is
    /// missing or too old.
    fn read_quotes(
        &self,
        prices: &HashMap<String, Option<Price>>,
        action: &Action,
    ) -> Option<HashMap<String, rules::Quote>> {
        let mut needed: Vec<String> = self.positions.iter().map(|p| p.symbol.clone()).collect();
        if let Action::Order { symbol, .. } = action {
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

    fn equity(&self, quotes: &HashMap<String, rules::Quote>) -> u128 {
        let mut equity = self.cash;
        for p in &self.positions {
            let m = rule(rules::market(&p.symbol));
            let value = rule(rules::mark_value(p.qty.0, &quotes[&p.symbol], m.decimals));
            equity = equity.checked_add(value).unwrap_or_else(|| env::panic_str("Overflow"));
        }
        equity
    }

    /// Takes away the trader's key in the same receipt that records the breach.
    fn breach(&mut self, reason: &str, equity: u128) {
        self.status = GuardStatus::Breached;
        self.breach_reason = Some(reason.to_string());
        let _ = Promise::new(env::current_account_id()).delete_key(self.trader_public_key.clone());
        let _ = Promise::new(self.tenor.clone()).function_call(
            "report_breach".to_string(),
            json!({ "reason": reason, "equity": U128(equity) }).to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            GAS_REPORT,
        );
        event("breach", json!({ "reason": reason, "equity": U128(equity) }));
    }

    fn continue_liquidation(&mut self, quotes: &HashMap<String, rules::Quote>) {
        match self.positions.first().cloned() {
            Some(p) => self.swap_sell(&p, quotes),
            None => {
                self.locked_at_ns = None;
                let _ = self.settle();
            }
        }
    }

    fn slippage_floor(fair_out: u128) -> u128 {
        rule(rules::mul_div_floor(
            fair_out,
            rules::BPS - MAX_SLIPPAGE_BPS,
            rules::BPS,
        ))
    }

    #[allow(clippy::too_many_arguments)]
    fn execute_order(
        &mut self,
        symbol: String,
        usdc: u128,
        trader_min: u128,
        tp_e8: Option<U128>,
        sl_e8: Option<U128>,
        equity: u128,
        quotes: &HashMap<String, rules::Quote>,
    ) {
        let m = rule(rules::market(&symbol));
        let quote = &quotes[&symbol];
        let held = self.positions.iter().find(|p| p.symbol == symbol).map_or(0, |p| {
            rule(rules::mark_value(p.qty.0, quote, m.decimals))
        });
        let cap = rule(rules::notional_cap(equity, m));
        if usdc > self.cash || held.saturating_add(usdc) > cap {
            // No panic here: it would revert the lock release and any rollover.
            self.locked_at_ns = None;
            event("order_rejected", json!({ "reason": "notional_cap", "cap": U128(cap), "held": U128(held), "order": U128(usdc) }));
            return;
        }
        let (fair_out, _) = rule(rules::fill_buy(usdc, quote, m.decimals));
        let min_out = trader_min.max(Self::slippage_floor(fair_out));
        let token = self.market_cfg(&symbol).unwrap().token.clone();
        let pool = self.market_cfg(&symbol).unwrap().pool_id;
        let usdc_token = self.usdc.clone();
        self.swap(&usdc_token, &token, pool, usdc, min_out, symbol, tp_e8, sl_e8);
    }

    fn swap_sell(&mut self, p: &Position, quotes: &HashMap<String, rules::Quote>) {
        let m = rule(rules::market(&p.symbol));
        let (fair_out, _) = rule(rules::fill_sell(p.qty.0, &quotes[&p.symbol], m.decimals));
        let token = self.market_cfg(&p.symbol).unwrap().token.clone();
        let pool = self.market_cfg(&p.symbol).unwrap().pool_id;
        let usdc_token = self.usdc.clone();
        self.swap(
            &token,
            &usdc_token,
            pool,
            p.qty.0,
            Self::slippage_floor(fair_out),
            p.symbol.clone(),
            None,
            None,
        );
    }

    #[allow(clippy::too_many_arguments)]
    fn swap(
        &mut self,
        token_in: &AccountId,
        token_out: &AccountId,
        pool_id: u64,
        amount: u128,
        min_amount_out: u128,
        symbol: String,
        tp_e8: Option<U128>,
        sl_e8: Option<U128>,
    ) {
        let msg = self.venue_kind.swap_msg(&SwapParams {
            token_in: token_in.as_str(),
            token_out: token_out.as_str(),
            pool_id,
            min_amount_out,
        });
        let _ = ft_call(
            token_in,
            "ft_transfer_call",
            json!({ "receiver_id": self.venue, "amount": U128(amount), "msg": msg }),
            GAS_SWAP,
        )
        .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_SWAP).on_swap(
            token_in.clone(),
            token_out.clone(),
            symbol,
            tp_e8,
            sl_e8,
            U128(amount),
        ));
    }

    fn apply_position(
        &mut self,
        symbol: &str,
        qty: u128,
        added_cost: u128,
        tp_e8: Option<U128>,
        sl_e8: Option<U128>,
    ) {
        match self.positions.iter().position(|p| p.symbol == symbol) {
            Some(i) if qty == 0 => {
                self.positions.remove(i);
            }
            Some(i) => {
                let p = &mut self.positions[i];
                p.qty = U128(qty);
                p.cost = U128(p.cost.0 + added_cost);
                p.tp_e8 = tp_e8.or(p.tp_e8);
                p.sl_e8 = sl_e8.or(p.sl_e8);
            }
            None if qty > 0 => self.positions.push(Position {
                symbol: symbol.to_string(),
                qty: U128(qty),
                cost: U128(added_cost),
                tp_e8,
                sl_e8,
            }),
            None => {}
        }
    }

    fn pay(&mut self, recipient: AccountId, trader: u128, firm: u128, settle_after: bool) -> Promise {
        self.locked_at_ns = Some(env::block_timestamp());
        let total = trader + firm;
        self.cash -= total;
        // Paid-out profit isn't a trading loss, so it must not count against the daily limit.
        self.day_start_equity = self.day_start_equity.saturating_sub(total);
        self.paid_to_trader += trader;
        self.paid_to_firm += firm;
        let usdc = self.usdc.clone();
        storage_deposit(&usdc, &recipient, FT_STORAGE)
            .then(ft_call(
                &usdc,
                "ft_transfer",
                json!({ "receiver_id": recipient, "amount": U128(trader) }),
                GAS_FT_TRANSFER,
            ))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_TRADER_PAID)
                    .on_trader_paid(U128(trader), U128(firm), settle_after),
            )
    }

    fn restore_payout(&mut self, amount: u128) {
        self.cash += amount;
        self.day_start_equity += amount;
    }

    /// Flat and finished. A closing trader gets their 80% first; a breached account forfeits.
    fn settle(&mut self) -> Promise {
        let profit = self.payable_profit();
        if self.status == GuardStatus::Closing && profit > 0 {
            let (trader, firm) = rule(rules::split_profit(profit));
            return self.pay(self.trader.clone(), trader, firm + self.firm_owed, true);
        }
        self.return_capital()
    }

    fn return_capital(&mut self) -> Promise {
        let prior = self.status.clone();
        let was_closing = prior == GuardStatus::Closing;
        let amount = self.cash;
        self.cash = 0;
        self.status = GuardStatus::Settled;
        let done = ft_call(
            &self.usdc.clone(),
            "ft_transfer_call",
            json!({
                "receiver_id": self.tenor,
                "amount": U128(amount),
                "msg": json!({ "action": "guard_return" }).to_string(),
            }),
            GAS_FT_RETURN,
        )
        .then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_ON_RETURNED)
                .on_capital_returned(U128(amount), prior),
        );
        if was_closing {
            // A breach already removed the key; a normal close removes it here.
            let _ = Promise::new(env::current_account_id())
                .delete_key(self.trader_public_key.clone());
        }
        done
    }

    fn reconcile(&mut self) -> Promise {
        let me = env::current_account_id();
        let mut reads = ft_balance(&self.usdc, me.clone());
        for m in &self.markets {
            reads = reads.and(ft_balance(&m.token, me.clone()));
        }
        reads.then(
            Self::ext(me)
                .with_static_gas(Gas::from_tgas(30))
                .on_reconciled(),
        )
    }
}

#[cfg(test)]
mod tests;
