//! Testnet stand-in for real liquidity. Takes `ft_transfer_call`, fills at oracle +/- conf plus
//! the taker fee, enforces `min_amount_out` and mints the output token to the sender.

use near_sdk::json_types::{I64, U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    PromiseError, PromiseOrValue,
};
use tenor_rules::{fill_buy, fill_sell, market, normalize, MAX_PRICE_AGE_SECS};

const GAS_ORACLE: Gas = Gas::from_tgas(10);
const GAS_ON_PRICE: Gas = Gas::from_tgas(55);
const GAS_MINT: Gas = Gas::from_tgas(15);
const GAS_ON_MINTED: Gas = Gas::from_tgas(5);

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Tokens,
}

#[derive(Clone)]
#[near(serializers = [json])]
pub struct Price {
    pub price: I64,
    pub conf: U64,
    pub expo: i32,
    pub publish_time: i64,
}

#[near(serializers = [json])]
pub struct SwapMsg {
    pub token_out: AccountId,
    pub min_amount_out: U128,
}

#[near(serializers = [json])]
pub struct MarketToken {
    pub symbol: String,
    pub token: AccountId,
}

#[ext_contract(ext_oracle)]
pub trait Oracle {
    fn get_price_no_older_than(&self, price_id: String, age: u64) -> Option<Price>;
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Contract {
    oracle: AccountId,
    usdc: AccountId,
    /// token account -> market symbol.
    tokens: LookupMap<AccountId, String>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(oracle: AccountId, usdc: AccountId, markets: Vec<MarketToken>) -> Self {
        let mut tokens = LookupMap::new(StorageKey::Tokens);
        for m in markets {
            require!(market(&m.symbol).is_ok(), "Unknown market");
            tokens.insert(m.token, m.symbol);
        }
        Self { oracle, usdc, tokens }
    }

    /// NEP-141 receiver. Refunds the whole input if the swap can't fill.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token_in = env::predecessor_account_id();
        let swap: SwapMsg = serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("Bad msg"));
        let (buy, symbol) = if token_in == self.usdc {
            (true, self.symbol_of(&swap.token_out))
        } else {
            require!(swap.token_out == self.usdc, "Output must be USDC");
            (false, self.symbol_of(&token_in))
        };
        let m = market(&symbol).unwrap_or_else(|_| env::panic_str("Unknown market"));
        ext_oracle::ext(self.oracle.clone())
            .with_static_gas(GAS_ORACLE)
            .get_price_no_older_than(m.feed_id.to_string(), MAX_PRICE_AGE_SECS)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_PRICE)
                    .on_price(sender_id, amount, swap.token_out, swap.min_amount_out, buy, symbol),
            )
            .into()
    }

    #[private]
    pub fn on_price(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        token_out: AccountId,
        min_amount_out: U128,
        buy: bool,
        symbol: String,
        #[callback_result] price: Result<Option<Price>, PromiseError>,
    ) -> PromiseOrValue<U128> {
        let m = market(&symbol).unwrap_or_else(|_| env::panic_str("Unknown market"));
        let Some(p) = price.ok().flatten() else {
            env::log_str("mock-swap: no fresh price, refunding");
            return PromiseOrValue::Value(amount);
        };
        let Ok(quote) = normalize(p.price.0, p.conf.0, p.expo) else {
            env::log_str("mock-swap: invalid price, refunding");
            return PromiseOrValue::Value(amount);
        };
        let filled = if buy {
            fill_buy(amount.0, &quote, m.decimals)
        } else {
            fill_sell(amount.0, &quote, m.decimals)
        };
        let out = match filled {
            Ok((out, _fee)) if out >= min_amount_out.0 && out > 0 => out,
            _ => {
                env::log_str("mock-swap: below min_amount_out, refunding");
                return PromiseOrValue::Value(amount);
            }
        };
        near_sdk::Promise::new(token_out)
            .function_call(
                "mint".to_string(),
                json!({ "account_id": sender_id, "amount": U128(out) })
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_MINT,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_MINTED)
                    .on_minted(amount),
            )
            .into()
    }

    #[private]
    pub fn on_minted(
        &mut self,
        amount: U128,
        #[callback_result] minted: Result<(), PromiseError>,
    ) -> U128 {
        if minted.is_ok() {
            U128(0)
        } else {
            amount
        }
    }
}

impl Contract {
    fn symbol_of(&self, token: &AccountId) -> String {
        self.tokens
            .get(token)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Unknown token"))
    }
}
