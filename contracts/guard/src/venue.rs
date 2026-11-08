//! One interface over swap venues. Every venue is driven the same way: the Guard sends the input
//! token with `ft_transfer_call(venue, amount, swap_msg)` and then measures its token balances,
//! so `mock-swap` (testnet) and Rhea (mainnet) are interchangeable.

use near_sdk::near;
use near_sdk::serde_json::json;

#[derive(Clone, PartialEq, Debug)]
#[near(serializers = [json, borsh])]
pub enum VenueKind {
    MockSwap,
    Rhea,
}

pub struct SwapParams<'a> {
    pub token_in: &'a str,
    pub token_out: &'a str,
    pub pool_id: u64,
    pub min_amount_out: u128,
}

pub trait Venue {
    fn swap_msg(&self, p: &SwapParams) -> String;
}

impl Venue for VenueKind {
    fn swap_msg(&self, p: &SwapParams) -> String {
        match self {
            VenueKind::MockSwap => json!({
                "token_out": p.token_out,
                "min_amount_out": p.min_amount_out.to_string(),
            })
            .to_string(),
            // Instant swap on v2.ref-finance.near. Format taken from @ref-finance/ref-sdk 1.5.0;
            // the DEX contract itself enforces min_amount_out.
            VenueKind::Rhea => json!({
                "force": 0,
                "actions": [{
                    "pool_id": p.pool_id,
                    "token_in": p.token_in,
                    "token_out": p.token_out,
                    "min_amount_out": p.min_amount_out.to_string(),
                }],
            })
            .to_string(),
        }
    }
}
