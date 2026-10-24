import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RARITIES, ITEMS, PITY, legendaryChance, expectedPullsToLegendary, rollCrate,
  cheapestPurchase, bestDollarsPerCrate, CRATE_COST_DBX,
} from '../src/economy.js';
import { createRng } from '../src/rng.js';

test('published odds sum to 100%', () => {
  const total = RARITIES.reduce((s, r) => s + r.odds, 0);
  assert.ok(Math.abs(total - 1) < 1e-12);
});

test('every rarity has at least one item; every item has a known rarity', () => {
  for (const r of RARITIES) assert.ok(ITEMS.some((i) => i.rarity === r.id), r.id);
  for (const i of ITEMS) assert.ok(RARITIES.some((r) => r.id === i.rarity), i.id);
});

test('pity: base rate, soft pity ramp, hard pity guarantee', () => {
  assert.equal(legendaryChance(1), 0.008);
  assert.equal(legendaryChance(PITY.softStart - 1), 0.008);
  assert.ok(legendaryChance(PITY.softStart) > 0.008);
  assert.equal(legendaryChance(PITY.hard), 1);
});

test('expected pulls to legendary is between soft and hard pity', () => {
  const e = expectedPullsToLegendary();
  assert.ok(e > 50 && e < PITY.hard, `E=${e}`);
});

test('Monte Carlo agrees with exact expected pulls (within 2%)', () => {
  const rng = createRng('mc');
  let pity = 0, legends = 0;
  const N = 400_000;
  for (let i = 0; i < N; i++) {
    const r = rollCrate(rng, pity);
    pity = r.pity;
    if (r.rarity === 'legendary') legends++;
  }
  const observed = N / legends;
  const exact = expectedPullsToLegendary();
  assert.ok(Math.abs(observed - exact) / exact < 0.02, `observed ${observed} vs exact ${exact}`);
});

test('no roll can exceed hard pity', () => {
  const rng = createRng('pity');
  let pity = 0, longest = 0;
  for (let i = 0; i < 100_000; i++) {
    const r = rollCrate(rng, pity);
    pity = r.pity;
    longest = Math.max(longest, pity);
  }
  assert.ok(longest < PITY.hard);
});

test('cheapest purchase always covers the need and exposes leftovers', () => {
  for (const need of [300, 600, 900, 1500, 3000, 9000]) {
    const p = cheapestPurchase(need);
    assert.ok(p.dbx >= need);
    assert.equal(p.leftover, p.dbx - need);
  }
  // One crate costs 300 DBX but the smallest bundle is 450 → 150 stranded.
  assert.equal(cheapestPurchase(CRATE_COST_DBX).leftover, 150);
});

test('dollars per crate is positive and below the smallest bundle', () => {
  const d = bestDollarsPerCrate();
  assert.ok(d > 0 && d < 4.99);
});
