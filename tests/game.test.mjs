import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, tickDrilling, chooseKillMethod, submitKillSheet, completeKill, useCompanyMan, resolveLosses, resolveStuck,
  resolveHse, resolveWeather, resolveWater, resolveSpill, acknowledge, completeWell, tickProduction, setChoke, installLift,
  plugAndAbandon, nextField, buyBundle, openCrate, equip, validateSave, serialize, setMudWeight, setPumpRate, currentEur,
  FIELDS_PER_CAMPAIGN, START_BUDGET, startField,
} from '../src/game.js';
import { createRng } from '../src/rng.js';

/** Resolve whatever event is open with a sensible default. */
function autoResolve(g) {
  const e = g.event;
  if (!e) return;
  switch (e.type) {
    case 'kick':
      chooseKillMethod(g, 'wait-weight');
      submitKillSheet(g, { kmw: e.sheet.kmw, icp: e.sheet.icp, fcp: e.sheet.fcp });
      useCompanyMan(g);
      break;
    case 'losses': resolveLosses(g, 'rate'); break;
    case 'stuck': resolveStuck(g, 'sidetrack'); break;
    case 'hse': resolveHse(g, 'safe'); break;
    case 'weather': resolveWeather(g, 'wait'); break;
    case 'water': resolveWater(g, 'handle'); break;
    case 'spill': resolveSpill(g, 'bioremediate'); break;
    default: acknowledge(g);
  }
}

function drillToTD(g) {
  for (let i = 0; i < 50_000 && g.f.phase === 'drilling'; i++) {
    g.f.drilling = true;
    tickDrilling(g, 2);
    autoResolve(g);
  }
}

function produceOut(g) {
  const rng = createRng('price');
  for (let i = 0; i < 50_000 && g.f.phase === 'production'; i++) {
    tickProduction(g, 15, rng);
    autoResolve(g);
  }
}

test('full field: casing points, kick, TD, production, P&A, report', () => {
  const g = newGame('field-test');
  drillToTD(g);
  assert.equal(g.f.phase, 'completion');
  assert.equal(g.f.shoe, 5000, 'both casing strings run');
  assert.ok(g.f.kicks >= 1, 'drilling into overpressure at 9.0 ppg takes a kick');
  completeWell(g);
  assert.ok(g.achievements['first-oil']);
  produceOut(g);
  assert.equal(g.f.phase, 'abandon');
  const rep = plugAndAbandon(g);
  assert.equal(g.f.phase, 'report');
  assert.ok(Number.isFinite(rep.npv) && rep.years >= 1);
  assert.ok(rep.recovery > 0 && rep.recovery < 0.6);
});

test('a well-prepared driller (12 ppg) avoids the kick', () => {
  const g = newGame('no-kick');
  setMudWeight(g, 12.0);
  drillToTD(g);
  assert.equal(g.f.kicks, 0);
  assert.ok(g.achievements['no-kick']);
});

test('low flow rate gets the pipe stuck', () => {
  const g = newGame('stuck');
  setMudWeight(g, 12.0);
  setPumpRate(g, 250);
  g.equipped.bit = 'diamond-turbo';
  g.inventory['diamond-turbo'] = 1;
  let stuck = false;
  for (let i = 0; i < 10_000 && g.f.phase === 'drilling'; i++) {
    g.f.drilling = true;
    tickDrilling(g, 1);
    if (g.event?.type === 'stuck') { stuck = true; break; }
    if (g.event) autoResolve(g);
  }
  assert.ok(stuck);
});

test('kill flow: method → sheet → result → mud weight updated', () => {
  const g = newGame('kill');
  g.f.depth = 4990; g.f.shoe = 2500;
  for (let i = 0; i < 500 && g.event?.type !== 'kick'; i++) {
    g.f.drilling = true;
    tickDrilling(g, 0.25);
    if (g.event && g.event.type !== 'kick') autoResolve(g);
  }
  assert.equal(g.event.type, 'kick');
  const s = g.event.sheet;
  chooseKillMethod(g, 'drillers');
  const check = submitKillSheet(g, { kmw: s.kmw, icp: s.icp, fcp: s.fcp });
  assert.ok(check.allOk);
  assert.ok(g.achievements.iwcf);
  completeKill(g, { grade: 'A', days: 2, dollars: 600_000, rekill: false });
  assert.equal(g.event.type, 'kill-result');
  assert.equal(g.f.mudWeight, s.kmw);
  assert.ok(g.achievements['clean-kill']);
  acknowledge(g);
  assert.equal(g.event, null);
});

test('production decisions: choke and lift change the rate', () => {
  const g = newGame('prod');
  g.f.phase = 'completion'; g.f.depth = 8000;
  completeWell(g);
  const rng = createRng('p');
  setChoke(g, '24');
  tickProduction(g, 1, rng);
  const small = g.f.well.rate;
  setChoke(g, '48');
  tickProduction(g, 1, rng);
  assert.ok(g.f.well.rate > small);
  const budget = g.budget;
  assert.ok(installLift(g, 'esp'));
  assert.ok(g.budget < budget - 2_000_000);
  assert.equal(installLift(g, 'esp'), false, 'cannot install twice');
});

test('five-field campaign ends with a score and best', () => {
  const g = newGame('campaign');
  for (let n = 0; n < FIELDS_PER_CAMPAIGN; n++) {
    setMudWeight(g, 12.0);
    drillToTD(g);
    completeWell(g);
    produceOut(g);
    plugAndAbandon(g);
    nextField(g);
  }
  assert.equal(g.campaignOver, true);
  assert.equal(g.results.length, FIELDS_PER_CAMPAIGN);
  assert.ok(Number.isFinite(g.best));
  assert.ok(g.achievements.campaign);
  assert.ok(g.achievements['free-to-play']);
});

test('crates: budget-funded crates land in the ledger as crate spend', () => {
  const g = newGame('crates');
  openCrate(g, 'budget');
  assert.equal(g.budget, START_BUDGET - 400_000);
  assert.equal(g.f.ledger[0].crates, 400_000);
  buyBundle(g, 'b4'); buyBundle(g, 'b4'); buyBundle(g, 'b1');
  assert.ok(g.achievements.whale);
  while (openCrate(g, 'dbx'));
  assert.ok(Object.keys(g.inventory).length > 0);
  assert.ok(equip(g, Object.keys(g.inventory)[0]));
});

test('save round-trip mid-production keeps progress; volumes re-derived', () => {
  const g = newGame('save');
  g.f.phase = 'completion'; g.f.depth = 8000;
  completeWell(g);
  const rng = createRng('s');
  for (let i = 0; i < 20; i++) { tickProduction(g, 10, rng); autoResolve(g); }
  const r = validateSave(serialize(g));
  assert.ok(r);
  assert.equal(r.f.phase, g.f.phase);
  assert.ok(Math.abs(r.f.well.qi - g.f.well.qi) < 1e-6);
  assert.ok(Math.abs(r.f.well.np - g.f.well.np) < 1e-6);
  assert.equal(r.f.well.choke, g.f.well.choke);
});

test('tampered saves are rejected or sanitised', () => {
  const g = newGame('evil');
  const base = JSON.parse(serialize(g));
  assert.equal(validateSave('{bad json'), null);
  assert.equal(validateSave({ ...base, v: 1 }), null);
  assert.equal(validateSave({ ...base, dbx: 1e99 }), null);
  assert.equal(validateSave({ ...base, seed: '<script>' }), null);
  assert.equal(validateSave({ ...base, fieldNo: 99 }), null);
  const polluted = JSON.parse(JSON.stringify(base).replace('"inventory":{}', '"inventory":{"__proto__":{"admin":true},"pdc":2,"fake":1}'));
  const r = validateSave(polluted);
  assert.deepEqual(Object.keys(r.inventory), ['pdc']);
  assert.equal(({}).admin, undefined);
  // A forged well with absurd production is reset to completion
  const forged = { ...base, f: { ...base.f, phase: 'production', depth: 8000, well: { skin: -99, pwf: 1, t: 0, te: 0, np: 1e20, mult: 1e9, choke: 'x', lift: 'magic' } } };
  assert.equal(validateSave(forged).f.phase, 'completion');
  // A forged np cannot exceed the re-derived EUR
  const g2 = newGame('cap'); g2.f.phase = 'completion'; g2.f.depth = 8000; completeWell(g2);
  const s2 = JSON.parse(serialize(g2)); s2.f.well.np = 9e9;
  const r2 = validateSave(s2);
  assert.ok(r2.f.well.np <= currentEur(r2) + 1);
  // Unknown achievements are dropped
  assert.deepEqual(validateSave({ ...base, achievements: { campaign: true, hacked: true } }).achievements, { campaign: true });
});

test('zero, negative or NaN time steps are ignored (no NaN budget)', () => {
  const g = newGame('dt');
  g.f.phase = 'completion'; g.f.depth = 8000;
  completeWell(g);
  const rng = createRng('dt');
  for (const d of [0, -0.016, NaN]) tickProduction(g, d, rng);
  assert.ok(Number.isFinite(g.budget) && Number.isFinite(g.f.well.np));
  const d = newGame('dt2');
  d.f.drilling = true;
  for (const hr of [0, -1, NaN]) tickDrilling(d, hr);
  assert.equal(d.f.depth, 0);
});

test('rate is capped by reserves: a small high-k field does not drain in months', () => {
  const g = newGame('a1'); g.fieldNo = 3; startField(g);
  g.f.phase = 'completion'; g.f.depth = 8000; completeWell(g);
  const rng = createRng('cap');
  let days = 0;
  for (let i = 0; i < 2000 && g.f.phase === 'production'; i++) { tickProduction(g, 10, rng); days += 10; if (g.event) g.event = null; }
  assert.ok(days > 730, `field lasted only ${days} days`);
});
