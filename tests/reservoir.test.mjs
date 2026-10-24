import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ooip, darcyRadialRate, arpsRate, arpsCumulative, hydrostatic, killMudWeight, icp, fcp, influxHeight, sicpFrom,
  influxGradientFrom, influxType, maasp, weakestFracGrad, wellControlCheck, formationAt, rateOfPenetration,
  annularVelocity, ecd, bitPressureDrop, hsi, standpipePressure, requiredAnnularVelocity, killSheet, strokes,
  ANNULAR_CAPACITY, naturalFlowFactor, waterCut, generateReservoir, wellForecast, NOZZLES,
} from '../src/reservoir.js';
import { createRng } from '../src/rng.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

test('volumetric OOIP matches hand calculation', () => {
  close(ooip({ area: 100, thickness: 50, porosity: 0.2, sw: 0.25, bo: 1.2 }), 4_848_750);
});

test('Darcy radial inflow and skin', () => {
  const p = { k: 50, h: 40, pr: 3000, pwf: 1500, mu: 1.5, bo: 1.2, re: 1490, rw: 0.354, skin: 0 };
  close(darcyRadialRate(p), (0.00708 * 50 * 40 * 1500) / (1.5 * 1.2 * (Math.log(1490 / 0.354) - 0.75)));
  assert.ok(darcyRadialRate({ ...p, skin: -3 }) > darcyRadialRate(p));
  assert.equal(darcyRadialRate({ ...p, pwf: 3500 }), 0);
});

test('Arps cumulative equals numerical integral', () => {
  for (const b of [0, 0.5, 1]) {
    const qi = 1200, di = 0.002, T = 1000, n = 100_000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += arpsRate(qi, di, b, (i + 0.5) * (T / n)) * (T / n);
    close(arpsCumulative(qi, di, b, T), sum, 1e-6);
  }
});

test('IWCF kill sheet: KMW, ICP, FCP by hand', () => {
  close(hydrostatic(10, 10_000), 5_200);
  close(killMudWeight(10, 520, 10_000), 11);
  assert.equal(icp(600, 520), 1120);
  close(fcp(600, 11, 10), 660);
});

test('SICP and influx gradient are inverse operations', () => {
  const pit = 20, omw = 10, sidpp = 500;
  const h = influxHeight(pit);
  close(h, pit / ANNULAR_CAPACITY);
  for (const grad of [0.1, 0.33, 0.45]) {
    const sicp = sicpFrom(sidpp, omw, pit, grad);
    assert.ok(sicp > sidpp, 'light influx → SICP above SIDPP');
    close(influxGradientFrom(sidpp, sicp, omw, pit), grad, 1e-9);
  }
  assert.equal(influxType(0.1), 'gas');
  assert.equal(influxType(0.33), 'oil or mixed');
  assert.equal(influxType(0.45), 'salt water');
});

test('MAASP from shoe fracture gradient', () => {
  // Shoe at 5,000 ft → overpressured shale below it, frac 0.82 psi/ft (15.77 ppg).
  close(maasp(5000, 12), (0.82 / 0.052 - 12) * 0.052 * 5000);
  assert.equal(maasp(0, 12), Infinity);
});

test('weakest open-hole fracture gradient depends on the shoe', () => {
  assert.equal(weakestFracGrad(0, 4000), 0.7);
  assert.equal(weakestFracGrad(2500, 6000), 0.75);
  assert.equal(weakestFracGrad(5000, 7900), 0.8);
});

test('well control: kick on static MW, losses on ECD', () => {
  assert.equal(formationAt(6000).name, 'Overpressured Shale');
  assert.equal(wellControlCheck(6000, 9.0, 9.4, 5000).status, 'kick');
  assert.equal(wellControlCheck(6000, 12.5, 12.9, 5000).status, 'ok');
  assert.equal(wellControlCheck(6000, 15.0, 16.0, 5000).status, 'losses');
  // Same mud, but circulating hard pushes ECD over the window
  assert.equal(wellControlCheck(4000, 12.5, 14.6, 2500).status, 'losses');
});

test('hydraulics move the right way', () => {
  close(annularVelocity(500), (24.5 * 500) / (8.5 ** 2 - 5 ** 2));
  assert.ok(ecd(8000, 600, 12) > ecd(8000, 400, 12), 'more flow → higher ECD');
  assert.ok(ecd(8000, 500, 12) > 12);
  assert.ok(bitPressureDrop(450, 12, NOZZLES.small.tfa) > bitPressureDrop(450, 12, NOZZLES.large.tfa), 'small nozzles → more bit pressure');
  assert.ok(hsi(450, 12, NOZZLES.small.tfa) > hsi(450, 12, NOZZLES.large.tfa));
  assert.ok(standpipePressure(8000, 700, 12, NOZZLES.small.tfa) > 4500, 'pump limit is reachable');
  assert.ok(requiredAnnularVelocity(200) > requiredAnnularVelocity(50), 'faster drilling needs more hole cleaning');
});

test('ROP: better bit, less overbalance, better jetting', () => {
  assert.ok(rateOfPenetration(3000, 2, 9) > rateOfPenetration(3000, 1, 9));
  assert.ok(rateOfPenetration(3000, 1, 9) > rateOfPenetration(3000, 1, 14));
  assert.ok(rateOfPenetration(3000, 1, 9, 6) > rateOfPenetration(3000, 1, 9, 1));
});

test('kill sheet object is internally consistent', () => {
  const s = killSheet({ depth: 5016, omw: 9.0, sidpp: 663, pitGain: 20, influxGradient: 0.1, shoeDepth: 5000 });
  assert.equal(s.kmw, 11.6);
  assert.equal(s.icp, s.scr + 663);
  assert.equal(s.fcp, Math.round((s.scr * 11.6) / 9));
  assert.ok(s.sicp > s.sidpp);
  assert.ok(s.maasp > 0 && s.maasp > s.sicp, 'kick at 5,000 ft is killable after the intermediate shoe');
  assert.deepEqual({ toBit: s.toBit, bottomsUp: s.bottomsUp }, strokes(5016));
});

test('production engineering curves', () => {
  assert.equal(naturalFlowFactor(0.2), 1);
  assert.ok(naturalFlowFactor(0.6) < 1 && naturalFlowFactor(0.6) >= 0.25);
  assert.equal(waterCut(0.2, 0.3), 0);
  assert.ok(waterCut(0.6, 0.3) > 0 && waterCut(1, 0.3) <= 0.95);
});

test('generated reservoirs are sensible', () => {
  const rng = createRng('fields');
  for (let i = 0; i < 200; i++) {
    const r = generateReservoir(rng);
    const f = wellForecast(r, { skin: 0, recoveryBonus: 0, pwf: 1200 });
    assert.ok(f.qi > 20 && f.qi < 100_000);
    assert.ok(f.eur > 0 && f.eur < f.ooip);
    assert.ok(r.waterBreakthrough >= 0.25 && r.waterBreakthrough <= 0.45);
  }
});
