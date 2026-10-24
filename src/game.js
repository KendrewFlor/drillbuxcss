// Game state + simulation. No DOM — runs (and is tested) under Node.
import {
  generateReservoir, wellForecast, rateOfPenetration, wellControlCheck, hydraulics, requiredAnnularVelocity,
  arpsRate, arpsCumulative, formationAt, killSheet, CASING_POINTS, TARGET_DEPTH, PUMP_LIMIT_PSI, NOZZLES, CHOKES, LIFTS,
  naturalFlowFactor, waterCut, darcyRadialRate, ooip,
} from './reservoir.js';
import { createRng } from './rng.js';
import { dailyRate, ledgerAdd, fieldEconomics } from './finance.js';
import { HSE_EVENTS, WEATHER, SPILL, RATES, chanceIn } from './events.js';
import { companyManResult, checkSheet } from './wellcontrol.js';
import { ITEMS, itemById, rollCrate, CRATE_COST_DBX, CRATE_COST_PETRODOLLARS, SCRAP_VALUE, BUNDLES, PITY } from './economy.js';

export const RIG_DAY_RATE = 180_000;
export const START_BUDGET = 60_000_000;
export const DISCOUNT_RATE = 0.1;
export const ROYALTY = 0.125;
export const OPEX_PER_BBL = 14;
export const FIXED_OPEX_PER_DAY = 25_000;
export const BASE_PWF = 1200;
export const DRILLING_DAMAGE_SKIN = 2;
export const COMPLETION_COST = 4_000_000;
export const FACILITIES_COST = 16_000_000; // subsea tie-back, flowline & processing share
export const LOSSES_COST = 400_000;
export const WORKOVER_COST = 3_500_000;
export const PA_COST = 3_000_000;
export const RIG_MOVE_COST = 2_500_000;
export const WATER_HANDLING_CAPEX = 2_000_000;
export const WATER_COST = { trucked: 2.5, handled: 0.8 }; // $/bbl water
export const STUCK = { jar: { chance: 0.6, days: 1, dollars: 300_000 }, sidetrack: { days: 6, dollars: 4_000_000, setback: 400 } };
export const SCRAP_PER_CRATE = 120;
export const FIELDS_PER_CAMPAIGN = 5;

export const ACHIEVEMENTS = [
  { id: 'first-oil', label: 'First oil', desc: 'Put a well on production.' },
  { id: 'no-kick', label: 'Textbook well', desc: 'Drill a field to TD without a kick.' },
  { id: 'clean-kill', label: 'Steady hand', desc: 'Grade A on the choke.' },
  { id: 'iwcf', label: 'Kill sheet ace', desc: 'Fill out a kill sheet perfectly without help.' },
  { id: 'stop-work', label: 'Stop-work authority', desc: 'Choose the safe option in 3 HSE events.' },
  { id: 'zero-harm', label: 'Zero harm', desc: 'Finish a field with no HSE incidents.' },
  { id: 'storm-wise', label: 'Weather-wise', desc: 'Wait on weather 3 times.' },
  { id: 'remediator', label: 'Soil saver', desc: 'Clean up a spill with bioremediation.' },
  { id: 'npv-positive', label: 'In the black', desc: 'Finish a field with positive NPV.' },
  { id: 'campaign', label: 'Five-field campaign', desc: 'Finish all five fields.' },
  { id: 'free-to-play', label: 'Free to play', desc: 'Finish the campaign without spending simulated money.' },
  { id: 'whale', label: 'Whale', desc: 'Spend $100 of simulated money. (The store thanks you.)' },
  { id: 'legendary', label: 'Legendary', desc: 'Pull a legendary item.' },
  { id: 'pity', label: 'Pity party', desc: 'Reach hard pity.' },
];

// ---------------------------------------------------------------- setup

export function newGame(seed, keep = {}) {
  const g = {
    v: 2,
    seed,
    mode: keep.mode ?? 'aaa',
    settings: keep.settings ?? { sound: true, tutorial: true, graphics: 'auto' },
    tipsSeen: keep.tipsSeen ?? {},
    achievements: keep.achievements ?? {},
    best: keep.best ?? null,
    fieldNo: 1,
    budget: START_BUDGET,
    dbx: 0, scrap: 0, realSpent: 0,
    cratesOpened: 0, legendaries: 0, pity: 0, rollCount: 0, draws: 0,
    inventory: {},
    equipped: { bit: null, completion: null, eor: null, cosmetic: null },
    timerResets: 0,
    project: { days: 0, npv: 0, cash: 0 },
    stats: { kicks: 0, stopWork: 0, incidents: 0, weatherWaits: 0, spills: 0 },
    results: [],
    campaignOver: false,
    oilPrice: 78,
    event: null,
    unlocked: [], // achievements unlocked since the UI last looked (not saved)
    notices: [], // short messages for the UI (not saved)
  };
  startField(g);
  return g;
}

export function reservoirOf(g) {
  if (!g._res || g._resKey !== `${g.seed}:${g.fieldNo}`) {
    g._res = generateReservoir(createRng(`${g.seed}:field:${g.fieldNo}`));
    g._resKey = `${g.seed}:${g.fieldNo}`;
  }
  return g._res;
}

export function startField(g) {
  g.f = {
    phase: 'drilling',
    depth: 0, mudWeight: 9.0, pumpRate: 450, nozzle: 'medium',
    drilling: false, shoe: 0, cuttings: 0, pumpAlarm: false,
    kicks: 0, incidents: 0, startDay: g.project.days,
    ledger: [], well: null, report: null, prodStart: null,
  };
  g.event = null;
}

/** Deterministic, save-proof randomness for events: re-derived from seed + counter. */
export function roll(g) {
  return createRng(`${g.seed}:evt:${g.draws++}`).next();
}

function unlock(g, id) {
  if (!g.achievements[id]) { g.achievements[id] = true; g.unlocked.push(id); }
}

function notice(g, text) { g.notices.push(text); }

// ---------------------------------------------------------------- money & time

/** Ledger year: drilling & completion capex at t = 0; production years count from 1. */
function year(g) {
  if (g.f.prodStart == null) return 0;
  return 1 + Math.max(0, Math.floor((g.project.days - g.f.prodStart) / 365));
}

/** Book a cost at the current project time, then advance time by `days`. */
export function spend(g, dollars, days = 0, kind = 'capex') {
  const i = dailyRate(DISCOUNT_RATE);
  g.budget -= dollars;
  g.project.cash -= dollars;
  g.project.npv -= dollars / Math.pow(1 + i, g.project.days);
  ledgerAdd(g.f.ledger, year(g), kind, dollars);
  g.project.days += days;
}

/** Time lost to an event: rig day rate on location, fixed opex while producing. */
export function loseDays(g, days) {
  if (g.f.phase === 'production') spend(g, FIXED_OPEX_PER_DAY * days, days, 'opex');
  else spend(g, RIG_DAY_RATE * days, days, 'capex');
}

export function effect(g, slot, key, fallback) {
  const id = g.equipped[slot];
  const item = id ? itemById(id) : null;
  return item?.effect?.[key] ?? fallback;
}

// ---------------------------------------------------------------- drilling

export function drillingHydraulics(g) {
  const f = g.f;
  return hydraulics(Math.max(1, f.depth), f.pumpRate, f.mudWeight, f.nozzle);
}

export function currentRop(g) {
  const h = drillingHydraulics(g);
  return rateOfPenetration(g.f.depth, effect(g, 'bit', 'rop', 1), g.f.mudWeight, h.hsi);
}

function rollHseOrWeather(g, days) {
  const producing = g.f.phase === 'production';
  if (roll(g) < chanceIn(days, producing ? RATES.hsePerProdDay : RATES.hsePerRigDay)) {
    const e = HSE_EVENTS[Math.floor(roll(g) * HSE_EVENTS.length)];
    g.event = { type: 'hse', id: e.id };
    return true;
  }
  if (roll(g) < chanceIn(days, producing ? RATES.weatherPerProdDay : RATES.weatherPerDay)) {
    g.event = { type: 'weather' };
    return true;
  }
  return false;
}

export function tickDrilling(g, hours) {
  const f = g.f;
  if (f.phase !== 'drilling' || !f.drilling || g.event || !(hours > 0)) return;
  const bit = effect(g, 'bit', 'rop', 1);
  let remaining = hours;
  while (remaining > 1e-9 && !g.event && f.drilling) {
    const step = Math.min(remaining, 0.25);
    const h = hydraulics(Math.max(1, f.depth), f.pumpRate, f.mudWeight, f.nozzle);
    if (h.spp > PUMP_LIMIT_PSI) {
      f.pumpAlarm = true;
      f.drilling = false;
      notice(g, 'Pump pressure limit — reduce flow rate or fit larger nozzles.');
      return;
    }
    f.pumpAlarm = false;
    const rop = rateOfPenetration(f.depth, bit, f.mudWeight, h.hsi);
    const req = requiredAnnularVelocity(rop);
    f.cuttings = h.av < req ? f.cuttings + ((req - h.av) / req) * step * 0.12 : Math.max(0, f.cuttings - 0.2 * step);
    if (f.cuttings >= 1) {
      f.cuttings = 1;
      f.drilling = false;
      g.event = { type: 'stuck', jarTried: false };
      return;
    }
    let next = Math.min(TARGET_DEPTH, f.depth + rop * step);
    const casing = CASING_POINTS.find((c) => f.shoe < c.depth && next >= c.depth);
    if (casing) next = casing.depth;
    spend(g, (RIG_DAY_RATE * step) / 24, step / 24);
    f.depth = next;
    remaining -= step;
    if (casing) {
      f.shoe = casing.depth;
      spend(g, casing.cost, casing.days);
      notice(g, `${casing.name} run and cemented at ${casing.depth.toLocaleString('en-US')} ft.`);
    }
    const hyd = hydraulics(f.depth, f.pumpRate, f.mudWeight, f.nozzle);
    const wc = wellControlCheck(f.depth, f.mudWeight, hyd.ecd, f.shoe);
    if (wc.status === 'kick') { createKick(g, wc.underbalancePsi); return; }
    if (wc.status === 'losses') {
      f.drilling = false;
      spend(g, LOSSES_COST, 0.5);
      g.event = { type: 'losses', depth: Math.round(f.depth), ecd: +hyd.ecd.toFixed(2), maxPpg: +wc.window[1].toFixed(2), formation: formationAt(f.depth).name };
      return;
    }
    if (rollHseOrWeather(g, step / 24)) { f.drilling = false; return; }
    if (f.depth >= TARGET_DEPTH) {
      f.drilling = false;
      f.phase = 'completion';
      if (f.kicks === 0) unlock(g, 'no-kick');
      return;
    }
  }
}

export function createKick(g, underbalancePsi) {
  const f = g.f;
  f.drilling = false;
  const sidpp = Math.ceil(underbalancePsi);
  const r = roll(g);
  const influxGradient = r < 0.7 ? 0.1 : r < 0.9 ? 0.33 : 0.45;
  const pitGain = Math.round(Math.min(60, 8 + underbalancePsi / 30 + roll(g) * 6));
  const sheet = killSheet({ depth: Math.round(f.depth), omw: f.mudWeight, sidpp, pitGain, influxGradient, shoeDepth: f.shoe });
  g.event = { type: 'kick', stage: 'shut-in', sheet, influxGradient, method: null, entered: null, check: null, assisted: false };
  f.kicks++;
  g.stats.kicks++;
}

export function chooseKillMethod(g, method) {
  if (g.event?.type !== 'kick' || !['drillers', 'wait-weight'].includes(method)) return;
  g.event.method = method;
  g.event.stage = 'sheet';
}

export function submitKillSheet(g, entered, assisted = false) {
  if (g.event?.type !== 'kick') return null;
  const clean = { kmw: +entered.kmw, icp: +entered.icp, fcp: +entered.fcp };
  g.event.entered = clean;
  g.event.check = checkSheet(clean, g.event.sheet);
  g.event.assisted = assisted;
  g.event.stage = 'choke';
  if (g.event.check.allOk && !assisted) unlock(g, 'iwcf');
  return g.event.check;
}

/** Apply the outcome of a kill (from the choke mini-game, or the company man). */
export function completeKill(g, result) {
  if (g.event?.type !== 'kick') return;
  const { sheet, entered } = g.event;
  loseDays(g, result.days);
  spend(g, result.dollars, 0);
  g.f.mudWeight = result.rekill || result.companyMan || !entered ? sheet.kmw : Math.max(entered.kmw, sheet.kmw);
  if (result.grade === 'A') unlock(g, 'clean-kill');
  g.event = { type: 'kill-result', result, sheet };
}

export function useCompanyMan(g) {
  if (g.event?.type !== 'kick') return;
  completeKill(g, companyManResult(g.event.sheet));
}

export function resolveLosses(g, choice) {
  if (g.event?.type !== 'losses') return;
  const f = g.f;
  const max = g.event.maxPpg;
  if (choice === 'rate') {
    while (f.pumpRate > 250 && drillingHydraulics(g).ecd > max - 0.1) f.pumpRate -= 25;
  }
  const loss = drillingHydraulics(g).ecd - f.mudWeight;
  if (drillingHydraulics(g).ecd > max - 0.1) f.mudWeight = Math.max(8.6, Math.floor((max - loss - 0.2) * 10) / 10);
  g.event = null;
}

export function resolveStuck(g, choice) {
  if (g.event?.type !== 'stuck') return null;
  const f = g.f;
  if (choice === 'jar' && !g.event.jarTried) {
    loseDays(g, STUCK.jar.days);
    spend(g, STUCK.jar.dollars, 0);
    if (roll(g) < STUCK.jar.chance) { f.cuttings = 0.4; g.event = null; return 'freed'; }
    g.event.jarTried = true;
    return 'still-stuck';
  }
  loseDays(g, STUCK.sidetrack.days);
  spend(g, STUCK.sidetrack.dollars, 0);
  f.depth = Math.max(f.shoe + 50, f.depth - STUCK.sidetrack.setback);
  f.cuttings = 0;
  g.event = null;
  return 'sidetracked';
}

export function resolveHse(g, choice) {
  if (g.event?.type !== 'hse') return null;
  const e = HSE_EVENTS.find((x) => x.id === g.event.id);
  if (choice === 'safe') {
    loseDays(g, e.safe.days);
    g.stats.stopWork++;
    if (g.stats.stopWork >= 3) unlock(g, 'stop-work');
    g.event = null;
    return { incident: false };
  }
  if (roll(g) < e.risky.chance) {
    loseDays(g, e.risky.days);
    spend(g, e.risky.dollars, 0, g.f.phase === 'production' ? 'opex' : 'capex');
    g.stats.incidents++;
    g.f.incidents++;
    g.event = { type: 'outcome', title: 'Incident', text: e.risky.outcome };
    return { incident: true };
  }
  g.event = null;
  return { incident: false };
}

export function resolveWeather(g, choice) {
  if (g.event?.type !== 'weather') return null;
  if (choice === 'wait') {
    const days = WEATHER.safe.minDays + roll(g) * (WEATHER.safe.maxDays - WEATHER.safe.minDays);
    loseDays(g, days);
    g.stats.weatherWaits++;
    if (g.stats.weatherWaits >= 3) unlock(g, 'storm-wise');
    g.event = null;
    return { incident: false, days };
  }
  if (roll(g) < WEATHER.risky.chance) {
    loseDays(g, WEATHER.risky.days);
    spend(g, WEATHER.risky.dollars, 0);
    g.stats.incidents++;
    g.f.incidents++;
    g.event = { type: 'outcome', title: 'Storm damage', text: WEATHER.risky.outcome };
    return { incident: true };
  }
  g.event = null;
  return { incident: false };
}

export function acknowledge(g) {
  if (g.event && ['outcome', 'kill-result'].includes(g.event.type)) g.event = null;
}

// ---------------------------------------------------------------- completion & production

export function completeWell(g) {
  const f = g.f;
  if (f.phase !== 'completion') return;
  const res = reservoirOf(g);
  const skin = DRILLING_DAMAGE_SKIN + effect(g, 'completion', 'skin', 0);
  const pwf = BASE_PWF - effect(g, 'eor', 'pwfDrop', 0);
  const fc = wellForecast(res, { skin, recoveryBonus: effect(g, 'eor', 'recovery', 0), pwf });
  f.well = { qi: fc.qi, ooip: fc.ooip, skin, pwf, t: 0, te: 0, np: 0, mult: 1, rate: fc.qi, waterRate: 0, wc: 0,
    choke: '40', lift: 'natural', waterHandling: false, wbtSeen: false, liftHinted: false };
  spend(g, COMPLETION_COST + FACILITIES_COST, 10);
  f.prodStart = g.project.days;
  f.phase = 'production';
  unlock(g, 'first-oil');
}

/** Mean-reverting oil price (Ornstein–Uhlenbeck on log price). dt in years. */
export const PRICE = { mean: 78, speed: 1.2, vol: 0.3, min: 25, max: 180 };
export function nextOilPrice(price, dt, rng) {
  const x = Math.log(price);
  const mu = Math.log(PRICE.mean);
  const next = x + PRICE.speed * (mu - x) * dt + PRICE.vol * Math.sqrt(dt) * rng.normal();
  return Math.min(PRICE.max, Math.max(PRICE.min, Math.exp(next)));
}

/** Reserves-limited rate cap: the rate a 10-year Arps decline needs to recover the EUR. */
export const RESERVE_LIFE_DAYS = 3650;
export function rateCap(g, eur = currentEur(g)) {
  const r = reservoirOf(g);
  return eur / arpsCumulative(1, r.di, r.b, RESERVE_LIFE_DAYS);
}

/** Initial well rate: the lower of Darcy deliverability and the reserves cap. */
export function initialRate(g) {
  const w = g.f.well;
  return w ? Math.min(w.qi, rateCap(g)) : 0;
}

export function currentEur(g) {
  const w = g.f.well;
  if (!w) return 0;
  const rf = Math.min(0.6, reservoirOf(g).baseRecovery + effect(g, 'eor', 'recovery', 0));
  return w.ooip * rf;
}

export function setChoke(g, key) {
  if (g.f.phase === 'production' && CHOKES[key]) g.f.well.choke = key;
}

export function installLift(g, key) {
  const w = g.f.well;
  if (g.f.phase !== 'production' || !LIFTS[key] || key === 'natural' || w.lift === key) return false;
  spend(g, LIFTS[key].capex, 0);
  loseDays(g, 4); // workover rig time, no production
  w.lift = key;
  return true;
}

export function installWaterHandling(g) {
  const w = g.f.well;
  if (g.f.phase !== 'production' || w.waterHandling) return false;
  spend(g, WATER_HANDLING_CAPEX, 0);
  loseDays(g, 3);
  w.waterHandling = true;
  return true;
}

export function workover(g) {
  if (g.f.phase !== 'production') return false;
  const w = g.f.well;
  const newSkin = DRILLING_DAMAGE_SKIN + effect(g, 'completion', 'skin', 0);
  if (newSkin >= w.skin) return false;
  const r = reservoirOf(g);
  const ln = Math.log(r.re / r.rw) - 0.75;
  w.mult *= (ln + w.skin) / (ln + newSkin);
  w.skin = newSkin;
  spend(g, WORKOVER_COST, 0);
  loseDays(g, 7);
  return true;
}

export function shutIn(g) {
  if (g.f.phase === 'production') g.f.phase = 'abandon';
}

export function resolveWater(g, choice) {
  if (g.event?.type !== 'water') return;
  g.event = null;
  if (choice === 'handle') installWaterHandling(g);
  if (choice === 'shut-in') shutIn(g);
}

export function resolveSpill(g, choice) {
  if (g.event?.type !== 'spill') return null;
  const o = SPILL.options.find((x) => x.id === choice);
  if (!o) return null;
  g.stats.spills++;
  if (o.days) loseDays(g, o.days);
  if (o.dollars) spend(g, o.dollars, 0, 'opex');
  if (o.id === 'bioremediate') unlock(g, 'remediator');
  if (o.id === 'ignore' && roll(g) < o.fineChance) {
    spend(g, o.fine, 0, 'opex');
    g.event = { type: 'outcome', title: 'Regulator fine', text: `The environmental regulator fined the operator $${(o.fine / 1e6).toFixed(1)}M and ordered a cleanup anyway.` };
    return { fined: true };
  }
  g.event = null;
  return { fined: false };
}

export function tickProduction(g, days, priceRng) {
  const f = g.f;
  if (f.phase !== 'production' || g.event || !(days > 0)) return;
  const w = f.well;
  const r = reservoirOf(g);
  const i = dailyRate(DISCOUNT_RATE);
  const eur = currentEur(g);
  const dt = days / 365;
  g.oilPrice = nextOilPrice(g.oilPrice, dt, priceRng);

  const choke = CHOKES[w.choke];
  const lift = LIFTS[w.lift];
  const depletion = eur > 0 ? w.np / eur : 1;
  w.te += days * choke.decline;
  w.t += days;
  const capacity = arpsRate(Math.min(w.qi * w.mult, rateCap(g, eur)), r.di, r.b, w.te) * choke.rate;
  const liftFactor = w.lift === 'natural' ? naturalFlowFactor(depletion) : lift.factor;
  const gross = Math.min(capacity * liftFactor, lift.cap);
  w.wc = waterCut(depletion, r.waterBreakthrough);
  const oil = Math.min(Math.max(0, eur - w.np) / days, gross * (1 - w.wc));
  w.rate = oil;
  w.waterRate = gross * w.wc;
  w.np += oil * days;

  const revenue = oil * days * g.oilPrice * (1 - ROYALTY);
  const opex = oil * days * OPEX_PER_BBL + w.waterRate * days * (w.waterHandling ? WATER_COST.handled : WATER_COST.trucked)
    + (FIXED_OPEX_PER_DAY + lift.opexDay) * days;
  const net = revenue - opex;
  ledgerAdd(f.ledger, year(g), 'revenue', revenue);
  ledgerAdd(f.ledger, year(g), 'opex', opex);
  g.budget += net;
  g.project.cash += net;
  g.project.npv += net / Math.pow(1 + i, g.project.days + days / 2);
  g.project.days += days;

  if (w.lift === 'natural' && depletion > 0.35 && !w.liftHinted) {
    w.liftHinted = true;
    notice(g, 'Natural flow is fading as reservoir pressure drops. Consider artificial lift.');
  }
  if (w.wc > 0 && !w.wbtSeen) {
    w.wbtSeen = true;
    g.event = { type: 'water' };
    return;
  }
  w.lossDays = net < 0 ? (w.lossDays ?? 0) + days : 0;
  if (w.np >= eur - 1 || (w.lossDays >= 60 && w.t > 180)) { f.phase = 'abandon'; return; }
  if (roll(g) < chanceIn(days, RATES.spillPerProdDay)) { g.event = { type: 'spill' }; return; }
  rollHseOrWeather(g, days);
}

// ---------------------------------------------------------------- abandonment, reports, campaign

export function plugAndAbandon(g) {
  const f = g.f;
  if (f.phase !== 'abandon') return null;
  spend(g, PA_COST, 6);
  const econ = fieldEconomics(f.ledger, DISCOUNT_RATE);
  const res = reservoirOf(g);
  f.report = {
    fieldNo: g.fieldNo,
    ...econ,
    recovery: f.well ? f.well.np / f.well.ooip : 0,
    np: f.well ? f.well.np : 0,
    ooip: ooip(res),
    kicks: f.kicks,
    incidents: f.incidents,
  };
  g.results.push({ fieldNo: g.fieldNo, npv: econ.npv, npvNoCrates: econ.npvNoCrates, irr: econ.irr, recovery: f.report.recovery, kicks: f.kicks, incidents: f.incidents });
  if (econ.npv > 0) unlock(g, 'npv-positive');
  if (f.incidents === 0) unlock(g, 'zero-harm');
  f.phase = 'report';
  return f.report;
}

export function campaignScore(g) {
  return g.project.npv;
}

export function nextField(g) {
  if (g.f.phase !== 'report') return;
  if (g.fieldNo >= FIELDS_PER_CAMPAIGN) {
    g.campaignOver = true;
    const score = campaignScore(g);
    g.best = g.best == null ? score : Math.max(g.best, score);
    unlock(g, 'campaign');
    if (g.realSpent === 0) unlock(g, 'free-to-play');
    return;
  }
  g.fieldNo++;
  startField(g);
  spend(g, RIG_MOVE_COST, 14);
}

// ---------------------------------------------------------------- monetization

export function buyBundle(g, bundleId) {
  const b = BUNDLES.find((x) => x.id === bundleId);
  if (!b) return null;
  g.dbx += b.dbx;
  g.realSpent = +(g.realSpent + b.price).toFixed(2);
  if (g.realSpent >= 100) unlock(g, 'whale');
  return b;
}

export function canOpen(g, currency) {
  if (currency === 'dbx') return g.dbx >= CRATE_COST_DBX;
  if (currency === 'budget') return g.budget >= CRATE_COST_PETRODOLLARS;
  if (currency === 'scrap') return g.scrap >= SCRAP_PER_CRATE;
  return false;
}

export function openCrate(g, currency) {
  if (!canOpen(g, currency)) return null;
  if (currency === 'dbx') g.dbx -= CRATE_COST_DBX;
  if (currency === 'budget') spend(g, CRATE_COST_PETRODOLLARS, 0, 'crates');
  if (currency === 'scrap') g.scrap -= SCRAP_PER_CRATE;
  if (g.pity + 1 >= PITY.hard) unlock(g, 'pity');
  const res = rollCrate(createRng(`${g.seed}:crate:${g.rollCount}`), g.pity);
  g.rollCount++;
  g.pity = res.pity;
  g.cratesOpened++;
  if (res.rarity === 'legendary') { g.legendaries++; unlock(g, 'legendary'); }
  const dup = (g.inventory[res.item.id] ?? 0) > 0;
  g.inventory[res.item.id] = (g.inventory[res.item.id] ?? 0) + 1;
  if (dup) g.scrap += SCRAP_VALUE[res.rarity];
  return { ...res, duplicate: dup };
}

export function equip(g, itemId) {
  const item = itemById(itemId);
  if (!item || !g.inventory[itemId]) return false;
  g.equipped[item.slot] = g.equipped[item.slot] === itemId ? null : itemId;
  return true;
}

// ---------------------------------------------------------------- drilling controls

export function setMudWeight(g, v) { if (Number.isFinite(v)) g.f.mudWeight = Math.min(17, Math.max(8.6, Math.round(v * 10) / 10)); }
export function setPumpRate(g, v) { if (Number.isFinite(v)) g.f.pumpRate = Math.min(750, Math.max(250, Math.round(v / 25) * 25)); }
export function setNozzle(g, key) { if (NOZZLES[key]) g.f.nozzle = key; }

// ---------------------------------------------------------------- save & validate
// localStorage is user-controlled. Validate everything; re-derive what can be derived.

const finite = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const ITEM_IDS = new Set(ITEMS.map((i) => i.id));
const ACH_IDS = new Set(ACHIEVEMENTS.map((a) => a.id));

export function serialize(g) {
  const { _res, _resKey, unlocked, notices, ...rest } = g;
  const copy = JSON.parse(JSON.stringify(rest));
  copy.f.drilling = false;
  // Mid-kill state restarts at shut-in; transient events are dropped.
  if (copy.event?.type === 'kick') copy.event = { type: 'kick', stage: 'shut-in', sheet: copy.event.sheet, influxGradient: copy.event.influxGradient };
  else if (copy.event && !['hse', 'weather', 'water', 'spill', 'stuck', 'losses'].includes(copy.event.type)) copy.event = null;
  return JSON.stringify(copy);
}

export function validateSave(raw) {
  try {
    if (typeof raw === 'string' && raw.length > 200_000) return null;
    const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!s || s.v !== 2 || typeof s.seed !== 'string' || !/^[a-z0-9:-]{1,64}$/i.test(s.seed)) return null;
    const checks = [
      [s.fieldNo, 1, FIELDS_PER_CAMPAIGN], [s.budget, -1e12, 1e12], [s.dbx, 0, 1e9], [s.scrap, 0, 1e9], [s.realSpent, 0, 1e9],
      [s.cratesOpened, 0, 1e9], [s.legendaries, 0, 1e9], [s.pity, 0, PITY.hard], [s.rollCount, 0, 1e9], [s.draws, 0, 1e12],
      [s.timerResets, 0, 1e9], [s.oilPrice, 1, 1000],
      [s.project?.days, 0, 1e7], [s.project?.npv, -1e13, 1e13], [s.project?.cash, -1e13, 1e13],
    ];
    if (!checks.every(([v, lo, hi]) => finite(v, lo, hi))) return null;
    if (!['aaa', 'regulator'].includes(s.mode)) return null;

    const keep = {
      mode: s.mode,
      settings: { sound: s.settings?.sound !== false, tutorial: s.settings?.tutorial !== false, graphics: ['auto', 'high', 'low'].includes(s.settings?.graphics) ? s.settings.graphics : 'auto' },
      tipsSeen: Object.fromEntries(Object.entries(s.tipsSeen ?? {}).filter(([k, v]) => /^[a-z-]{1,32}$/.test(k) && v === true)),
      achievements: Object.fromEntries(Object.entries(s.achievements ?? {}).filter(([k, v]) => ACH_IDS.has(k) && v === true)),
      best: finite(s.best, -1e13, 1e13) ? s.best : null,
    };
    const g = newGame(s.seed, keep);
    const inventory = {};
    for (const [k, v] of Object.entries(s.inventory ?? {})) if (ITEM_IDS.has(k) && finite(v, 0, 1e6)) inventory[k] = Math.floor(v);
    const equipped = { bit: null, completion: null, eor: null, cosmetic: null };
    for (const slot of Object.keys(equipped)) {
      const id = s.equipped?.[slot];
      if (id && ITEM_IDS.has(id) && inventory[id] && itemById(id).slot === slot) equipped[slot] = id;
    }
    const stats = {};
    for (const k of Object.keys(g.stats)) stats[k] = finite(s.stats?.[k], 0, 1e6) ? Math.floor(s.stats[k]) : 0;
    const results = Array.isArray(s.results) ? s.results.slice(0, FIELDS_PER_CAMPAIGN).filter((r) =>
      finite(r?.fieldNo, 1, FIELDS_PER_CAMPAIGN) && finite(r.npv, -1e13, 1e13) && finite(r.npvNoCrates, -1e13, 1e13)
      && (r.irr === null || finite(r.irr, -1, 100)) && finite(r.recovery, 0, 1) && finite(r.kicks, 0, 1e4) && finite(r.incidents, 0, 1e4))
      .map(({ fieldNo, npv, npvNoCrates, irr, recovery, kicks, incidents }) => ({ fieldNo, npv, npvNoCrates, irr, recovery, kicks, incidents })) : [];
    Object.assign(g, {
      fieldNo: s.fieldNo, budget: s.budget, dbx: s.dbx, scrap: s.scrap, realSpent: s.realSpent,
      cratesOpened: s.cratesOpened, legendaries: s.legendaries, pity: s.pity, rollCount: s.rollCount, draws: s.draws,
      inventory, equipped, stats, results, timerResets: s.timerResets, oilPrice: s.oilPrice,
      project: { days: s.project.days, npv: s.project.npv, cash: s.project.cash },
      campaignOver: s.campaignOver === true,
    });

    // ----- field
    const sf = s.f ?? {};
    const phase = ['drilling', 'completion', 'production', 'abandon', 'report'].includes(sf.phase) ? sf.phase : 'drilling';
    if (!finite(sf.depth, 0, TARGET_DEPTH) || !finite(sf.mudWeight, 8.6, 17) || !finite(sf.pumpRate, 250, 750) || !NOZZLES[sf.nozzle]
      || ![0, ...CASING_POINTS.map((c) => c.depth)].includes(sf.shoe) || !finite(sf.cuttings, 0, 1) || !finite(sf.startDay, 0, s.project.days)
      || !finite(sf.kicks, 0, 1e4) || !finite(sf.incidents, 0, 1e4)) return g; // keep account progress, restart the field
    const ledger = Array.isArray(sf.ledger) ? sf.ledger.slice(0, 100).map((y) => ({
      capex: finite(y?.capex, 0, 1e12) ? y.capex : 0, opex: finite(y?.opex, 0, 1e12) ? y.opex : 0,
      revenue: finite(y?.revenue, 0, 1e12) ? y.revenue : 0, crates: finite(y?.crates, 0, 1e12) ? y.crates : 0,
    })) : [];
    const prodStart = finite(sf.prodStart, sf.startDay, s.project.days) ? sf.prodStart : null;
    Object.assign(g.f, {
      prodStart, phase, depth: sf.depth, mudWeight: sf.mudWeight, pumpRate: sf.pumpRate, nozzle: sf.nozzle, shoe: sf.shoe,
      cuttings: sf.cuttings, startDay: sf.startDay, kicks: sf.kicks, incidents: sf.incidents, ledger,
    });
    // Correct shoe for depth (a shoe below the bit is impossible)
    if (g.f.shoe > g.f.depth) g.f.shoe = 0;

    if (phase === 'production' || phase === 'abandon') {
      const w = sf.well ?? {};
      const res = reservoirOf(g);
      const ok = finite(w.skin, -10, 20) && finite(w.pwf, 100, 3000) && finite(w.t, 0, 1e6) && finite(w.te, 0, 2e6)
        && finite(w.np, 0, 1e10) && finite(w.mult, 0.1, 10) && CHOKES[w.choke] && LIFTS[w.lift];
      if (!ok || prodStart == null) { g.f.phase = 'completion'; g.f.depth = TARGET_DEPTH; g.f.prodStart = null; return g; }
      // Rates and volumes are re-derived from the seeded reservoir, never trusted from storage.
      const qi = darcyRadialRate({ k: res.k, h: res.thickness, pr: res.pr, pwf: w.pwf, mu: res.mu, bo: res.bo, re: res.re, rw: res.rw, skin: w.skin });
      g.f.well = { qi, ooip: ooip(res), skin: w.skin, pwf: w.pwf, t: w.t, te: w.te, np: 0, mult: w.mult, rate: 0, waterRate: 0, wc: 0,
        choke: w.choke, lift: w.lift, waterHandling: w.waterHandling === true, wbtSeen: w.wbtSeen === true, liftHinted: w.liftHinted === true };
      g.f.well.np = Math.min(w.np, currentEur(g));
    }
    if (phase === 'report') { g.f.phase = 'abandon'; g.f.well = null; } // report is regenerated

    // ----- pending event
    const e = s.event;
    if (e?.type === 'kick' && e.sheet) {
      const sh = e.sheet;
      if (finite(sh.depth, 1, TARGET_DEPTH) && finite(sh.omw, 8.6, 17) && finite(sh.sidpp, 1, 5000) && finite(sh.pitGain, 1, 100)
        && [0.1, 0.33, 0.45].includes(e.influxGradient) && finite(sh.shoeDepth, 0, TARGET_DEPTH)) {
        g.event = { type: 'kick', stage: 'shut-in', influxGradient: e.influxGradient, method: null, entered: null, check: null, assisted: false,
          sheet: killSheet({ depth: sh.depth, omw: sh.omw, sidpp: sh.sidpp, pitGain: sh.pitGain, influxGradient: e.influxGradient, shoeDepth: sh.shoeDepth }) };
      }
    } else if (e?.type === 'hse' && HSE_EVENTS.some((x) => x.id === e.id)) g.event = { type: 'hse', id: e.id };
    else if (e?.type === 'weather') g.event = { type: 'weather' };
    else if (e?.type === 'stuck') g.event = { type: 'stuck', jarTried: e.jarTried === true };
    else if (e?.type === 'water' && g.f.phase === 'production') g.event = { type: 'water' };
    else if (e?.type === 'spill' && g.f.phase === 'production') g.event = { type: 'spill' };
    else if (e?.type === 'losses' && finite(e.maxPpg, 8, 20) && finite(e.ecd, 8, 25) && finite(e.depth, 0, TARGET_DEPTH)) {
      g.event = { type: 'losses', depth: e.depth, ecd: e.ecd, maxPpg: e.maxPpg, formation: formationAt(e.depth).name };
    }
    return g;
  } catch {
    return null;
  }
}
