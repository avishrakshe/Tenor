//! A shared list of bad counterparties. Anyone can report an account by attaching evidence and a
//! small deposit that pays for the storage. One report is a warning. An account counts as blocked
//! once two different reporters agree, or the owner confirms it, so one reporter can't blacklist
//! a rival alone.

use near_sdk::json_types::U64;
use near_sdk::store::IterableMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault};

const REPORT_DEPOSIT: NearToken = NearToken::from_millinear(10);
const MAX_EVIDENCE: usize = 256;
const MAX_REPORTS: usize = 20;
const BLOCK_THRESHOLD: usize = 2;

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Entries,
}

#[derive(Clone)]
#[near(serializers = [json, borsh])]
pub struct Report {
    pub reporter: AccountId,
    /// A transaction hash or link that shows the bad behaviour.
    pub evidence: String,
    pub reported_at: U64,
}

#[derive(Clone, Default)]
#[near(serializers = [json, borsh])]
pub struct Entry {
    pub reports: Vec<Report>,
    pub confirmed: bool,
}

#[near(serializers = [json])]
pub struct Status {
    pub account: AccountId,
    pub reports: u32,
    pub confirmed: bool,
    pub blocked: bool,
    pub evidence: Vec<Report>,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Contract {
    owner: AccountId,
    entries: IterableMap<AccountId, Entry>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner,
            entries: IterableMap::new(StorageKey::Entries),
        }
    }

    #[payable]
    pub fn report(&mut self, account: AccountId, evidence: String) {
        require!(env::attached_deposit() >= REPORT_DEPOSIT, "Attach 0.01 NEAR to report");
        require!(!evidence.is_empty(), "Evidence is required");
        require!(evidence.len() <= MAX_EVIDENCE, "Evidence is too long");
        let reporter = env::predecessor_account_id();
        require!(reporter != account, "Cannot report yourself");
        let mut entry = self.entries.get(&account).cloned().unwrap_or_default();
        require!(!entry.reports.iter().any(|r| r.reporter == reporter), "Already reported");
        require!(entry.reports.len() < MAX_REPORTS, "Too many reports");
        entry.reports.push(Report {
            reporter,
            evidence,
            reported_at: U64(env::block_timestamp() / 1_000_000_000),
        });
        self.entries.insert(account, entry);
    }

    /// Reporters can take back their own report.
    pub fn retract(&mut self, account: AccountId) {
        let reporter = env::predecessor_account_id();
        let mut entry = self
            .entries
            .get(&account)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Not reported"));
        let before = entry.reports.len();
        entry.reports.retain(|r| r.reporter != reporter);
        require!(entry.reports.len() < before, "You have not reported this account");
        if entry.reports.is_empty() && !entry.confirmed {
            self.entries.remove(&account);
        } else {
            self.entries.insert(account, entry);
        }
    }

    pub fn set_confirmed(&mut self, account: AccountId, confirmed: bool) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        let mut entry = self.entries.get(&account).cloned().unwrap_or_default();
        entry.confirmed = confirmed;
        self.entries.insert(account, entry);
    }

    pub fn status(&self, account: AccountId) -> Status {
        let entry = self.entries.get(&account).cloned().unwrap_or_default();
        Status {
            blocked: entry.confirmed || entry.reports.len() >= BLOCK_THRESHOLD,
            reports: entry.reports.len() as u32,
            confirmed: entry.confirmed,
            evidence: entry.reports,
            account,
        }
    }

    pub fn list(&self, from_index: u32, limit: u32) -> Vec<Status> {
        self.entries
            .keys()
            .skip(from_index as usize)
            .take(limit as usize)
            .map(|a| self.status(a.clone()))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn ctx(who: &str, deposit: NearToken) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(who.parse().unwrap())
            .attached_deposit(deposit)
            .build());
    }

    fn list() -> Contract {
        ctx("owner.near", NearToken::from_yoctonear(0));
        Contract::new("owner.near".parse().unwrap())
    }

    fn report(c: &mut Contract, who: &str) {
        ctx(who, REPORT_DEPOSIT);
        c.report("bad.near".parse().unwrap(), "tx:abc".into());
    }

    fn bad() -> AccountId {
        "bad.near".parse().unwrap()
    }

    #[test]
    fn one_report_warns_and_two_block() {
        let mut c = list();
        report(&mut c, "a.near");
        assert!(!c.status(bad()).blocked);
        assert_eq!(c.status(bad()).reports, 1);
        report(&mut c, "b.near");
        assert!(c.status(bad()).blocked);
    }

    #[test]
    fn owner_can_confirm_alone() {
        let mut c = list();
        ctx("owner.near", NearToken::from_yoctonear(0));
        c.set_confirmed(bad(), true);
        assert!(c.status(bad()).blocked);
    }

    #[test]
    fn retracting_clears_the_report() {
        let mut c = list();
        report(&mut c, "a.near");
        ctx("a.near", NearToken::from_yoctonear(0));
        c.retract(bad());
        assert_eq!(c.status(bad()).reports, 0);
        assert!(c.list(0, 10).is_empty());
    }

    #[test]
    #[should_panic(expected = "Attach 0.01 NEAR")]
    fn report_needs_the_deposit() {
        let mut c = list();
        ctx("a.near", NearToken::from_yoctonear(0));
        c.report(bad(), "tx".into());
    }

    #[test]
    #[should_panic(expected = "Evidence is required")]
    fn report_needs_evidence() {
        let mut c = list();
        ctx("a.near", REPORT_DEPOSIT);
        c.report(bad(), "".into());
    }

    #[test]
    #[should_panic(expected = "Evidence is too long")]
    fn evidence_is_bounded() {
        let mut c = list();
        ctx("a.near", REPORT_DEPOSIT);
        c.report(bad(), "x".repeat(257));
    }

    #[test]
    #[should_panic(expected = "Already reported")]
    fn one_vote_per_reporter() {
        let mut c = list();
        report(&mut c, "a.near");
        report(&mut c, "a.near");
    }

    #[test]
    #[should_panic(expected = "Cannot report yourself")]
    fn no_self_reports() {
        let mut c = list();
        report(&mut c, "bad.near");
    }

    #[test]
    #[should_panic(expected = "Only the owner")]
    fn confirm_is_owner_only() {
        let mut c = list();
        ctx("a.near", NearToken::from_yoctonear(0));
        c.set_confirmed(bad(), true);
    }

    #[test]
    #[should_panic(expected = "You have not reported")]
    fn cannot_retract_someone_elses_report() {
        let mut c = list();
        report(&mut c, "a.near");
        ctx("b.near", NearToken::from_yoctonear(0));
        c.retract(bad());
    }
}
