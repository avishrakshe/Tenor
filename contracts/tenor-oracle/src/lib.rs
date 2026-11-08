//! Price store with the same view interface as Pyth on NEAR, so `tenor`, `guard` and `mock-swap`
//! read either one by changing an account id. Interface: pyth-crosschain
//! target_chains/near/receiver/src/ext.rs. See https://docs.near.org/primitives/oracles
//!
//! Exists because Hermes needs a paid API key since 2026-08-26 and `pyth-oracle.testnet` has
//! been stale since June 2026. With `open_push` set, anyone can post prices: that mode is only
//! for the scripted demo stack.

use near_sdk::json_types::{I64, U64};
use near_sdk::store::IterableMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};
use std::collections::HashMap;

const FUTURE_TOLERANCE_SECS: i64 = 10;

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Prices,
}

#[derive(Clone)]
#[near(serializers = [json, borsh])]
pub struct Price {
    pub price: I64,
    pub conf: U64,
    pub expo: i32,
    pub publish_time: i64,
}

#[near(serializers = [json])]
pub struct PriceUpdate {
    pub price_id: String,
    pub price: I64,
    pub conf: U64,
    pub expo: i32,
    pub publish_time: i64,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Contract {
    owner: AccountId,
    pusher: AccountId,
    open_push: bool,
    stale_threshold: u64,
    prices: IterableMap<String, Price>,
}

fn now_secs() -> i64 {
    (env::block_timestamp() / 1_000_000_000) as i64
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, pusher: AccountId, open_push: bool, stale_threshold: u64) -> Self {
        Self {
            owner,
            pusher,
            open_push,
            stale_threshold,
            prices: IterableMap::new(StorageKey::Prices),
        }
    }

    pub fn push_prices(&mut self, updates: Vec<PriceUpdate>) {
        require!(
            self.open_push || env::predecessor_account_id() == self.pusher,
            "Only the pusher can post prices"
        );
        let now = now_secs();
        for u in updates {
            require!(u.price.0 > 0, "Price must be positive");
            require!(
                u.publish_time <= now + FUTURE_TOLERANCE_SECS,
                "publish_time is in the future"
            );
            if let Some(old) = self.prices.get(&u.price_id) {
                require!(u.publish_time >= old.publish_time, "publish_time went backwards");
            }
            self.prices.insert(
                u.price_id,
                Price {
                    price: u.price,
                    conf: u.conf,
                    expo: u.expo,
                    publish_time: u.publish_time,
                },
            );
        }
    }

    pub fn set_pusher(&mut self, pusher: AccountId) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        self.pusher = pusher;
    }

    pub fn get_stale_threshold(&self) -> u64 {
        self.stale_threshold
    }

    pub fn is_open_push(&self) -> bool {
        self.open_push
    }

    pub fn price_feed_exists(&self, price_identifier: String) -> bool {
        self.prices.contains_key(&price_identifier)
    }

    pub fn get_price(&self, price_identifier: String) -> Option<Price> {
        self.fresh(&price_identifier, self.stale_threshold)
    }

    pub fn get_price_unsafe(&self, price_identifier: String) -> Option<Price> {
        self.prices.get(&price_identifier).cloned()
    }

    pub fn get_price_no_older_than(&self, price_id: String, age: u64) -> Option<Price> {
        self.fresh(&price_id, age)
    }

    pub fn list_prices(&self, price_ids: Vec<String>) -> HashMap<String, Option<Price>> {
        price_ids
            .into_iter()
            .map(|id| {
                let price = self.fresh(&id, self.stale_threshold);
                (id, price)
            })
            .collect()
    }

    pub fn list_prices_unsafe(&self, price_ids: Vec<String>) -> HashMap<String, Option<Price>> {
        price_ids
            .into_iter()
            .map(|id| {
                let price = self.prices.get(&id).cloned();
                (id, price)
            })
            .collect()
    }
}

impl Contract {
    fn fresh(&self, id: &str, age: u64) -> Option<Price> {
        let now = now_secs();
        self.prices
            .get(id)
            .filter(|p| now.saturating_sub(p.publish_time) <= age as i64)
            .cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const T0: u64 = 1_800_000_000;

    fn ctx(who: &str, secs: u64) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(who.parse().unwrap())
            .block_timestamp(secs * 1_000_000_000)
            .build());
    }

    fn update(price: i64, t: i64) -> Vec<PriceUpdate> {
        vec![PriceUpdate {
            price_id: "aa".into(),
            price: I64(price),
            conf: U64(1),
            expo: -8,
            publish_time: t,
        }]
    }

    fn oracle(open: bool) -> Contract {
        ctx("owner.near", T0);
        Contract::new("owner.near".parse().unwrap(), "pusher.near".parse().unwrap(), open, 60)
    }

    #[test]
    fn pusher_can_post_and_price_goes_stale() {
        let mut o = oracle(false);
        ctx("pusher.near", T0);
        o.push_prices(update(100, T0 as i64));
        assert_eq!(o.get_price("aa".into()).unwrap().price.0, 100);
        ctx("anyone.near", T0 + 60);
        assert!(o.get_price("aa".into()).is_some());
        ctx("anyone.near", T0 + 61);
        assert!(o.get_price("aa".into()).is_none());
        assert!(o.get_price_unsafe("aa".into()).is_some());
        assert_eq!(o.list_prices(vec!["aa".into()])["aa"].is_none(), true);
    }

    #[test]
    #[should_panic(expected = "Only the pusher")]
    fn stranger_cannot_post() {
        let mut o = oracle(false);
        ctx("stranger.near", T0);
        o.push_prices(update(100, T0 as i64));
    }

    #[test]
    fn open_mode_lets_anyone_post() {
        let mut o = oracle(true);
        ctx("stranger.near", T0);
        o.push_prices(update(100, T0 as i64));
        assert!(o.price_feed_exists("aa".into()));
    }

    #[test]
    #[should_panic(expected = "Price must be positive")]
    fn rejects_non_positive_price() {
        let mut o = oracle(true);
        o.push_prices(update(0, T0 as i64));
    }

    #[test]
    #[should_panic(expected = "in the future")]
    fn rejects_future_timestamps() {
        let mut o = oracle(true);
        o.push_prices(update(1, T0 as i64 + 11));
    }

    #[test]
    #[should_panic(expected = "went backwards")]
    fn rejects_old_timestamps() {
        let mut o = oracle(true);
        o.push_prices(update(1, T0 as i64));
        o.push_prices(update(1, T0 as i64 - 1));
    }

    #[test]
    #[should_panic(expected = "Only the owner")]
    fn only_owner_changes_pusher() {
        let mut o = oracle(false);
        ctx("stranger.near", T0);
        o.set_pusher("stranger.near".parse().unwrap());
    }
}
