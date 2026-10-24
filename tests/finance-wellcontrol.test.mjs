import { test } from 'node:test';
import assert from 'node:assert/strict';
import { npv, irr, paybackPeriod, profitabilityIndex, ledgerAdd, fieldEconomics, dailyRate } from '../src/finance.js';
import { createKillOp, step, setChoke, idealChoke, targets, checkSheet, companyManResult, METHODS } from '../src/wellcontrol.js';
import { killSheet } from '../src/reservoir.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

test('NPV, IRR, payback, PI by hand', () => {
  const cf = [-1000, 300, 400, 500];
  close(npv(0.1, cf), -1000 + 300 / 1.1 + 400 / 1.21 + 500 / 1.331);
  const r = irr(cf);
  close(npv(r, cf), 0, 1e-6);
  close(paybackPeriod(cf), 2 + 300 / 500); // 300 left after year 2, repaid 0.6 into year 3
  close(profitabilityIndex(0.1, cf), (300 / 1.1 + 400 / 1.21 + 500 / 1.331) / 1000);
  assert.equal(irr([-100, -50, -10]), null, 'no sign change → no IRR');
  assert.equal(paybackPeriod([-100, 10, 10]), null);
  close(Math.pow(1 + dailyRate(0.1), 365), 1.1);
});

test('ledger separates crate spend for with/without comparison', () => {
  const L = [];
  ledgerAdd(L, 0, 'capex', 1000);
  ledgerAdd(L, 0, 'crates', 200);
  ledgerAdd(L, 1, 'revenue', 900);
  ledgerAdd(L, 2, 'revenue', 900);
  const e = fieldEconomics(L, 0.1);
  assert.equal(e.crateSpend, 200);
  close(e.npvNoCrates - e.npv, 200);
  assert.equal(e.years, 3);
});

const sheet = killSheet({ depth: 6000, omw: 10, sidpp: 520, pitGain: 18, influxGradient: 0.1, shoeDepth: 5000 });
const correct = { kmw: sheet.kmw, icp: sheet.icp, fcp: sheet.fcp };

test('kill sheet checking', () => {
  assert.equal(checkSheet(correct, sheet).allOk, true);
  assert.equal(checkSheet({ ...correct, kmw: sheet.kmwExact - 0.2 }, sheet).kmwOk, false, 'too light');
  assert.equal(checkSheet({ ...correct, icp: sheet.icp + 100 }, sheet).icpOk, false);
  assert.equal(checkSheet({ kmw: NaN, icp: 1, fcp: 1 }, sheet).allOk, false);
});

function runPerfect(method, entered = correct) {
  const op = createKillOp({ sheet, entered, method });
  while (!op.done) {
    // A perfect operator holds the choke at the ideal opening for the player's schedule.
    const tg = targets(op);
    setChoke(op, idealChoke(op) + (tg.correct - tg.player) / 14);
    step(op, 0.05);
  }
  return op.result;
}

test('perfect choke work with a correct sheet earns an A, both methods', () => {
  for (const m of Object.keys(METHODS)) {
    const r = runPerfect(m);
    assert.equal(r.grade, 'A', `${m}: rms ${r.rms}`);
    assert.equal(r.influx, false);
    assert.equal(r.rekill, false);
  }
});

test('following a wrong (low) ICP perfectly still underbalances the well', () => {
  const r = runPerfect('wait-weight', { ...correct, icp: correct.icp - 250 });
  assert.ok(r.influx, 'secondary influx from following a low schedule');
  assert.equal(r.grade, 'D');
});

test('kill mud lighter than required forces a re-kill', () => {
  const r = runPerfect('wait-weight', { ...correct, kmw: sheet.kmwExact - 0.3 });
  assert.ok(r.rekill);
  assert.ok(r.days > METHODS['wait-weight'].circDays);
});

test('doing nothing on the choke grades poorly', () => {
  const op = createKillOp({ sheet, entered: correct, method: 'drillers' });
  setChoke(op, 100); // wide open the whole time
  while (!op.done) step(op, 0.05);
  assert.ok(['C', 'D'].includes(op.result.grade));
});

test('company man costs more than a good kill', () => {
  const good = runPerfect('wait-weight');
  const cm = companyManResult(sheet);
  assert.ok(cm.dollars > good.dollars && cm.days > good.days);
});

test('IRR handles a negative final year (P&A) and very high returns', () => {
  const cf = [-40, 300, 50, -3];
  const r = irr(cf);
  assert.ok(r !== null && Math.abs(npv(r, cf)) < 1e-6);
  const big = irr([-10, 500]);
  close(big, 49, 1e-6);
});
