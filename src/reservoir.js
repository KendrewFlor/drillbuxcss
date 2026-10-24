// Petroleum engineering core — pure functions, oilfield units, no DOM.
// Every formula is covered by tests/reservoir.test.mjs and documented in
// docs/PETROLEUM_MODEL.md.

export const G = 0.052; // psi/ft per ppg

// ---------------------------------------------------------------- reservoir

/** Volumetric OOIP, STB. A [acres], h [ft], phi, Sw [frac], Bo [rb/STB] */
export function ooip({ area, thickness, porosity, sw, bo }) {
  return (7758 * area * thickness * porosity * (1 - sw)) / bo;
}

/** Pseudo-steady-state radial Darcy inflow, STB/d. */
export function darcyRadialRate({ k, h, pr, pwf, mu, bo, re, rw, skin }) {
  const denom = mu * bo * (Math.log(re / rw) - 0.75 + skin);
  if (denom <= 0) throw new RangeError('Inflow denominator must be positive.');
  return Math.max(0, (0.00708 * k * h * (pr - pwf)) / denom);
}

export function arpsRate(qi, di, b, t) {
  if (b === 0) return qi * Math.exp(-di * t);
  if (b === 1) return qi / (1 + di * t);
  return qi / Math.pow(1 + b * di * t, 1 / b);
}

export function arpsCumulative(qi, di, b, t) {
  const q = arpsRate(qi, di, b, t);
  if (b === 0) return (qi - q) / di;
  if (b === 1) return (qi / di) * Math.log(1 + di * t);
  return (Math.pow(qi, b) / ((1 - b) * di)) * (Math.pow(qi, 1 - b) - Math.pow(q, 1 - b));
}

// ---------------------------------------------------------------- pressure

export const hydrostatic = (mw, tvd) => G * mw * tvd;
export const gradientToPpg = (grad) => grad / G;

/** Stratigraphic column, depths in ft TVD. */
export const FORMATIONS = [
  { id: 'alluvium', name: 'Recent Alluvium & Clay', top: 0, base: 2500, poreGrad: 0.465, fracGrad: 0.7, hardness: 1.0, color: '#8a7a5c' },
  { id: 'miocene', name: 'Miocene Sand–Shale', top: 2500, base: 5000, poreGrad: 0.465, fracGrad: 0.75, hardness: 1.4, color: '#6f6a58' },
  { id: 'shale', name: 'Overpressured Shale', top: 5000, base: 6800, poreGrad: 0.6, fracGrad: 0.82, hardness: 1.8, color: '#4b4f55' },
  { id: 'cap', name: 'Cap Rock (Limestone)', top: 6800, base: 7200, poreGrad: 0.52, fracGrad: 0.85, hardness: 2.2, color: '#9a9384' },
  { id: 'reservoir', name: 'Reservoir Sandstone', top: 7200, base: 8000, poreGrad: 0.52, fracGrad: 0.8, hardness: 1.3, color: '#c29a4a' },
];
export const TARGET_DEPTH = 8000;
export const RESERVOIR_TOP = 7200;
/** Casing points: 13-3/8" surface at 2,500 ft, 9-5/8" intermediate at 5,000 ft. */
export const CASING_POINTS = [
  { depth: 2500, name: '13⅜″ surface casing', cost: 1_200_000, days: 1.5 },
  { depth: 5000, name: '9⅝″ intermediate casing', cost: 1_800_000, days: 2 },
];

export function formationAt(depth) {
  return FORMATIONS.find((f) => depth >= f.top && depth < f.base) ?? FORMATIONS[FORMATIONS.length - 1];
}

/** Weakest fracture gradient in open hole between the shoe and the bit. */
export function weakestFracGrad(shoeDepth, bitDepth) {
  const open = FORMATIONS.filter((f) => f.base > shoeDepth && f.top <= Math.max(shoeDepth, bitDepth));
  return Math.min(...open.map((f) => f.fracGrad));
}

/** Formation just below the shoe (where the leak-off test is taken). */
export function shoeFormation(shoeDepth) {
  return formationAt(shoeDepth + 1);
}

/** Maximum allowable annular surface pressure, psi. */
export function maasp(shoeDepth, mw) {
  if (shoeDepth <= 0) return Infinity;
  const fg = shoeFormation(shoeDepth).fracGrad;
  return Math.max(0, (gradientToPpg(fg) - mw) * G * shoeDepth);
}

// ---------------------------------------------------------------- hydraulics
// 8-1/2" hole, 5" drill pipe. Pressure losses are calibrated power-law fits —
// simplified for a game, but they move the right way for the right reasons.

export const HOLE_D = 8.5, PIPE_D = 5.0, BIT_AREA = (Math.PI / 4) * HOLE_D ** 2; // in²
export const NOZZLES = {
  small: { label: '3 × 11/32″', tfa: 0.278 },
  medium: { label: '3 × 13/32″', tfa: 0.389 },
  large: { label: '3 × 16/32″', tfa: 0.589 },
};
export const PUMP_LIMIT_PSI = 4500;

export function annularVelocity(q) {
  return (24.5 * q) / (HOLE_D ** 2 - PIPE_D ** 2); // ft/min
}

export function annularPressureLoss(depth, q, mw) {
  return 0.00144 * depth * Math.pow(q / 100, 1.8) * (mw / 10);
}

export function drillStringLoss(depth, q, mw) {
  return 0.0069 * depth * Math.pow(q / 100, 1.8) * (mw / 10);
}

export function bitPressureDrop(q, mw, tfa) {
  return (mw * q * q) / (12032 * tfa * tfa);
}

/** Hydraulic horsepower per square inch of bit area. */
export function hsi(q, mw, tfa) {
  return (bitPressureDrop(q, mw, tfa) * q) / 1714 / BIT_AREA;
}

/** Equivalent circulating density, ppg. */
export function ecd(depth, q, mw) {
  if (depth <= 0) return mw;
  return mw + annularPressureLoss(depth, q, mw) / (G * depth);
}

export function standpipePressure(depth, q, mw, tfa) {
  return 100 + drillStringLoss(depth, q, mw) + bitPressureDrop(q, mw, tfa) + annularPressureLoss(depth, q, mw);
}

/** Minimum annular velocity for hole cleaning, ft/min — faster drilling makes more cuttings. */
export function requiredAnnularVelocity(rop) {
  return 100 + 0.5 * rop;
}

/** Full hydraulics snapshot for the console. */
export function hydraulics(depth, q, mw, nozzle) {
  const tfa = NOZZLES[nozzle].tfa;
  return {
    av: annularVelocity(q),
    ecd: ecd(depth, q, mw),
    spp: standpipePressure(depth, q, mw, tfa),
    bitDp: bitPressureDrop(q, mw, tfa),
    hsi: hsi(q, mw, tfa),
  };
}

// ---------------------------------------------------------------- drilling

export function rateOfPenetration(depth, bitMultiplier, mw, hsiValue = 6) {
  const f = formationAt(depth);
  const base = 95 / f.hardness;
  const overbalancePpg = Math.max(0, mw - gradientToPpg(f.poreGrad));
  const chipHoldDown = 1 / (1 + 0.08 * overbalancePpg);
  const jetting = 0.8 + 0.3 * Math.min(1, hsiValue / 6);
  return base * bitMultiplier * chipHoldDown * jetting;
}

/**
 * Well control state at the bit while drilling.
 * Kick: static mud hydrostatic below pore pressure (pumps off on connections).
 * Losses: circulating ECD above the weakest open-hole fracture gradient.
 */
export function wellControlCheck(depth, mw, ecdValue, shoeDepth) {
  const f = formationAt(depth);
  const pp = f.poreGrad * depth;
  const hp = hydrostatic(mw, depth);
  const fracGrad = weakestFracGrad(shoeDepth, depth);
  const window = [gradientToPpg(f.poreGrad), gradientToPpg(fracGrad)];
  if (hp < pp) return { status: 'kick', underbalancePsi: pp - hp, window };
  if (ecdValue > window[1]) return { status: 'losses', overPpg: ecdValue - window[1], window };
  return { status: 'ok', window };
}

// ---------------------------------------------------------------- well control (IWCF)

export const ANNULAR_CAPACITY = (HOLE_D ** 2 - PIPE_D ** 2) / 1029.4; // bbl/ft, 8.5" × 5"
export const STRING_CAPACITY = 0.01776; // bbl/ft, 5" 19.5 lb/ft DP
export const PUMP_OUTPUT = 0.1; // bbl/stroke
export const SCR_PSI_AT_8000 = 650; // slow circulating rate pressure at 30 spm

/** Kill mud weight, ppg (not rounded). */
export function killMudWeight(omw, sidpp, tvd) {
  return omw + sidpp / (G * tvd);
}

/** Initial circulating pressure, psi. */
export function icp(scr, sidpp) {
  return scr + sidpp;
}

/** Final circulating pressure, psi. */
export function fcp(scr, kmw, omw) {
  return (scr * kmw) / omw;
}

/** Influx height from pit gain, ft. */
export function influxHeight(pitGain) {
  return pitGain / ANNULAR_CAPACITY;
}

/** SICP from SIDPP and influx: the light influx in the annulus adds surface pressure. */
export function sicpFrom(sidpp, omw, pitGain, influxGradient) {
  return sidpp + (G * omw - influxGradient) * influxHeight(pitGain);
}

/** Influx gradient, psi/ft — < 0.25 gas, 0.25–0.4 oil/mixed, > 0.4 water. */
export function influxGradientFrom(sidpp, sicp, omw, pitGain) {
  return G * omw - (sicp - sidpp) / influxHeight(pitGain);
}

export function influxType(grad) {
  if (grad < 0.25) return 'gas';
  if (grad <= 0.4) return 'oil or mixed';
  return 'salt water';
}

export function slowCirculatingRate(depth) {
  return Math.round((SCR_PSI_AT_8000 * depth) / 8000 / 10) * 10 + 150;
}

/** Strokes surface-to-bit and bit-to-surface. */
export function strokes(depth) {
  return {
    toBit: Math.round((STRING_CAPACITY * depth) / PUMP_OUTPUT),
    bottomsUp: Math.round((ANNULAR_CAPACITY * depth) / PUMP_OUTPUT),
  };
}

/** Builds a complete, correct kill sheet for a kick. */
export function killSheet({ depth, omw, sidpp, pitGain, influxGradient, shoeDepth }) {
  const scr = slowCirculatingRate(depth);
  const kmwExact = killMudWeight(omw, sidpp, depth);
  const kmw = Math.ceil(kmwExact * 10) / 10;
  const sicp = Math.round(sicpFrom(sidpp, omw, pitGain, influxGradient));
  return {
    depth, omw, sidpp, sicp, pitGain, scr, shoeDepth,
    kmw, kmwExact,
    icp: icp(scr, sidpp),
    fcp: Math.round(fcp(scr, kmw, omw)),
    maasp: Math.round(maasp(shoeDepth, omw)),
    ...strokes(depth),
  };
}

// ---------------------------------------------------------------- field generation

export function generateReservoir(rng) {
  return {
    area: Math.round(rng.range(160, 640)),
    thickness: Math.round(rng.range(40, 110)),
    porosity: +rng.range(0.14, 0.28).toFixed(3),
    sw: +rng.range(0.18, 0.38).toFixed(3),
    bo: +rng.range(1.15, 1.45).toFixed(3),
    k: Math.round(rng.range(35, 220)),
    mu: +rng.range(0.8, 3.5).toFixed(2),
    pr: Math.round(0.52 * 7600 + rng.range(-150, 250)),
    re: 1490,
    rw: 0.354,
    baseRecovery: +rng.range(0.12, 0.22).toFixed(3),
    b: +rng.range(0.3, 0.9).toFixed(2),
    di: +(rng.range(0.25, 0.6) / 365).toFixed(5),
    waterBreakthrough: +rng.range(0.25, 0.45).toFixed(2), // fraction of EUR produced
  };
}

export function wellForecast(res, { skin, recoveryBonus, pwf }) {
  const qi = darcyRadialRate({ k: res.k, h: res.thickness, pr: res.pr, pwf, mu: res.mu, bo: res.bo, re: res.re, rw: res.rw, skin });
  const n = ooip(res);
  const rf = Math.min(0.6, res.baseRecovery + recoveryBonus);
  return { qi, ooip: n, recoveryFactor: rf, eur: n * rf };
}

// ---------------------------------------------------------------- production engineering

/** Bean (choke) sizes: rate now vs. faster decline. */
export const CHOKES = {
  '24': { label: '24/64″', rate: 0.6, decline: 0.7 },
  '32': { label: '32/64″', rate: 0.8, decline: 0.85 },
  '40': { label: '40/64″', rate: 1.0, decline: 1.0 },
  '48': { label: '48/64″', rate: 1.15, decline: 1.25 },
};

export const LIFTS = {
  natural: { label: 'Natural flow', capex: 0, opexDay: 0, factor: 1, cap: Infinity, blurb: 'Free while reservoir pressure holds.' },
  rod: { label: 'Rod pump', capex: 800_000, opexDay: 3_000, factor: 1.0, cap: 1_500, blurb: 'Cheap and simple; tops out around 1,500 STB/d.' },
  gaslift: { label: 'Gas lift', capex: 1_500_000, opexDay: 5_000, factor: 1.1, cap: Infinity, blurb: 'Injected gas lightens the column. Handles sand well.' },
  esp: { label: 'ESP', capex: 2_500_000, opexDay: 8_000, factor: 1.25, cap: Infinity, blurb: 'Electric submersible pump. Highest rate, highest power bill.' },
};

/** Natural flow fades as the reservoir depletes (pressure support falls). */
export function naturalFlowFactor(depletion) {
  if (depletion <= 0.35) return 1;
  return Math.max(0.25, 1 - (depletion - 0.35) * 1.6);
}

/** Water cut after breakthrough, 0–0.95. */
export function waterCut(depletion, breakthrough) {
  if (depletion <= breakthrough) return 0;
  return Math.min(0.95, ((depletion - breakthrough) / (1 - breakthrough)) * 1.3);
}
