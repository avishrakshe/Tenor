import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isImplicit, score } from '../src/index.js';

const clean = { blocked: false, reports: 0, confirmed: false, evidence: [] };
const healthy = { receiver: 'alice.near', implicit: false, blocklist: clean, exists: true, isContract: false, ageDays: 400, txCount: 90, priorInteractions: 3 };

const verdict = (over, opts) => score({ ...healthy, ...over }, opts).verdict;

test('an established account with history is allowed', () => assert.equal(verdict({}), 'allow'));
test('two reports block', () => assert.equal(verdict({ blocklist: { ...clean, reports: 2, blocked: true } }), 'block'));
test('a confirmed entry blocks', () => assert.equal(verdict({ blocklist: { ...clean, confirmed: true, blocked: true } }), 'block'));
test('one report only warns', () => assert.equal(verdict({ blocklist: { ...clean, reports: 1 } }), 'warn'));
test('an unreadable blocklist asks a human', () => assert.equal(verdict({ blocklist: undefined }), 'warn'));
test('a missing named account blocks', () => assert.equal(verdict({ exists: false }), 'block'));
test('an unused implicit address warns', () => assert.equal(verdict({ receiver: 'a'.repeat(64), implicit: true, exists: false }), 'warn'));
test('an unknown existence asks a human', () => assert.equal(verdict({ exists: undefined }), 'warn'));
test('a new account warns', () => assert.equal(verdict({ ageDays: 2 }), 'warn'));
test('an unknown age asks a human', () => assert.equal(verdict({ ageDays: undefined }), 'warn'));
test('thin history warns', () => assert.equal(verdict({ txCount: 1 }), 'warn'));
test('a contract warns', () => assert.equal(verdict({ isContract: true, codeChanged1d: false, codeChanged7d: false }), 'warn'));
test('code changed in 24h blocks', () => assert.equal(verdict({ isContract: true, codeChanged1d: true, codeChanged7d: true }), 'block'));
test('a first-time payee alone is not a warning', () => assert.equal(verdict({ priorInteractions: 0 }), 'allow'));
test('block outranks every warning', () => {
  const r = score({ ...healthy, ageDays: 1, blocklist: { ...clean, reports: 3, blocked: true } });
  assert.equal(r.verdict, 'block');
  assert.equal(r.reasons[0].level, 'block');
});
test('your own account is always allowed', () => assert.equal(verdict({ ageDays: 0, txCount: 0 }, { trusted: ['alice.near'] }), 'allow'));
test('implicit address detection', () => {
  assert.equal(isImplicit('a'.repeat(64)), true);
  assert.equal(isImplicit(`0x${'b'.repeat(40)}`), true);
  assert.equal(isImplicit('alice.near'), false);
});
