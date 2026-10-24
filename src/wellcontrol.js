// Kill operation simulator for the choke-panel mini-game. Pure; no DOM.
//
// The player follows the drill-pipe pressure (DPP) schedule from *their own*
// kill sheet by working the choke. If their sheet is wrong, following it
// perfectly still puts the wrong pressure on bottom — exactly as in real life.

export const METHODS = {
  'wait-weight': { label: 'Wait & Weight', circulations: 1, waitDays: 0.4, circDays: 1.2, seconds: 34,
    blurb: 'Weight up first, then kill in one circulation. Lower casing pressure; needs a correct kill sheet.' },
  drillers: { label: "Driller's method", circulations: 2, waitDays: 0, circDays: 2.0, seconds: 44,
    blurb: 'Circulate the kick out with old mud, then pump kill mud. Simpler, but slower and higher casing pressure.' },
};

export const KILL_MATERIALS = 600_000;
export const PENALTY = {
  influx: { days: 0.8, dollars: 700_000 },
  losses: { days: 0.6, dollars: 900_000 },
  rekill: { days: 1.5, dollars: 900_000 },
};
export const COMPANY_MAN = { days: 1.0, dollars: 800_000 };

const CHOKE_GAIN = 14; // psi of DPP per % of choke opening
const LAG_SECONDS = 0.6;

/** Grades a filled-in kill sheet against the correct one. */
export function checkSheet(entered, sheet) {
  const kmwOk = Number.isFinite(entered.kmw) && entered.kmw >= sheet.kmwExact - 1e-9 && entered.kmw <= sheet.kmw + 0.1 + 1e-9;
  const icpOk = Number.isFinite(entered.icp) && Math.abs(entered.icp - sheet.icp) <= 15;
  const fcpOk = Number.isFinite(entered.fcp) && Math.abs(entered.fcp - sheet.fcp) <= 15;
  return { kmwOk, icpOk, fcpOk, allOk: kmwOk && icpOk && fcpOk };
}

function schedule(icpV, fcpV, toBit, s) {
  return s < toBit ? icpV + (fcpV - icpV) * (s / toBit) : fcpV;
}

/** Phase layout in strokes for each method. */
function phases(method, sheet) {
  if (method === 'drillers') {
    return [
      { name: 'First circulation — kick out with original mud', strokes: sheet.bottomsUp, killMud: false },
      { name: 'Second circulation — kill mud', strokes: sheet.toBit + sheet.bottomsUp, killMud: true },
    ];
  }
  return [{ name: 'Kill circulation', strokes: sheet.toBit + sheet.bottomsUp, killMud: true }];
}

export function createKillOp({ sheet, entered, method }) {
  const ph = phases(method, sheet);
  const total = ph.reduce((s, p) => s + p.strokes, 0);
  return {
    sheet, entered, method, phases: ph,
    total, strokes: 0, t: 0,
    strokesPerSecond: total / METHODS[method].seconds,
    choke: 50,
    dpp: sheet.icp, cp: sheet.sicp, err: 0,
    sumSq: 0, samples: 0, underTime: 0, overTime: 0, maxPit: sheet.pitGain,
    trace: [], done: false, result: null,
  };
}

/** Which phase and strokes-into-phase for a global stroke count. */
export function locate(op, s = op.strokes) {
  let acc = 0;
  for (let i = 0; i < op.phases.length; i++) {
    const p = op.phases[i];
    if (s < acc + p.strokes || i === op.phases.length - 1) return { index: i, phase: p, s: Math.min(p.strokes, s - acc) };
    acc += p.strokes;
  }
  return null;
}

/** DPP the player should hold (from their sheet) and the truly correct value. */
export function targets(op, s = op.strokes) {
  const { phase, s: ps } = locate(op, s);
  const { sheet, entered } = op;
  if (!phase.killMud) return { player: entered.icp, correct: sheet.icp };
  return {
    player: schedule(entered.icp, entered.fcp, sheet.toBit, ps),
    correct: schedule(sheet.icp, sheet.fcp, sheet.toBit, ps),
  };
}

/** Choke opening that would hold bottom-hole pressure exactly. Drifts so the player must react. */
export function idealChoke(op, s = op.strokes) {
  const p = s / op.total;
  const { phase, s: ps } = locate(op, s);
  const annulusStart = phase.killMud ? op.sheet.toBit : 0;
  const a = Math.max(0, Math.min(1, (ps - annulusStart) / op.sheet.bottomsUp));
  // Gas expanding near surface: choke must be closed in, then opened as it vents.
  const gasHere = op.method === 'drillers' ? !phase.killMud : true;
  const gas = gasHere ? -16 * Math.exp(-(((a - 0.82) / 0.07) ** 2)) + 10 * Math.exp(-(((a - 0.95) / 0.04) ** 2)) : 0;
  return 46 + 11 * Math.sin(2 * Math.PI * p * 1.7) + 7 * Math.sin(2 * Math.PI * p * 4.3 + 1) + gas;
}

function casingBase(op, s) {
  const { phase, s: ps } = locate(op, s);
  const annulusStart = phase.killMud ? op.sheet.toBit : 0;
  const a = Math.max(0, Math.min(1, (ps - annulusStart) / op.sheet.bottomsUp));
  const gasHere = op.method === 'drillers' ? !phase.killMud : true;
  const peakFactor = op.method === 'drillers' ? 0.55 : 0.35; // Driller's sees a higher casing peak
  if (gasHere) return Math.max(0, op.sheet.sicp * (1 + peakFactor * Math.sin(Math.PI * Math.min(1, a / 0.9))) * (a < 0.97 ? 1 : (1 - a) / 0.03));
  // Driller's second circulation: annulus already gas-free, casing pressure bleeds to zero as kill mud rises.
  return Math.max(0, (op.sheet.sicp - op.sheet.sidpp) * 0.2 + op.sheet.sidpp * (1 - a));
}

/** Advance the simulation by dt seconds. */
export function step(op, dt) {
  if (op.done) return op;
  op.t += dt;
  op.strokes = Math.min(op.total, op.strokes + op.strokesPerSecond * dt);
  const tg = targets(op);
  const actual = tg.correct + CHOKE_GAIN * (idealChoke(op) - op.choke);
  const k = 1 - Math.exp(-dt / LAG_SECONDS);
  op.dpp += (actual - op.dpp) * k;
  op.err = op.dpp - tg.correct; // bottom-hole pressure error, psi
  op.cp = Math.max(0, casingBase(op, op.strokes) + op.err);
  op.sumSq += op.err * op.err * dt;
  op.samples += dt;
  if (op.err < -150) { op.underTime += dt; op.maxPit += 4 * dt; }
  if (op.cp > op.sheet.maasp || op.err > 350) op.overTime += dt;
  if (op.trace.length === 0 || op.strokes - op.trace[op.trace.length - 1].s >= op.total / 160) {
    op.trace.push({ s: op.strokes, dpp: op.dpp, target: tg.player, cp: op.cp });
  }
  if (op.strokes >= op.total) finish(op);
  return op;
}

export function setChoke(op, pct) {
  op.choke = Math.max(0, Math.min(100, pct));
}

export function finish(op) {
  const rms = Math.sqrt(op.sumSq / Math.max(1e-6, op.samples));
  const influx = op.underTime > 1.5;
  const losses = op.overTime > 1;
  const rekill = !(op.entered.kmw >= op.sheet.kmwExact - 1e-9);
  let grade = rms < 40 ? 'A' : rms < 80 ? 'B' : rms < 140 ? 'C' : 'D';
  if (influx || losses || rekill) grade = grade < 'D' ? 'D' : grade;
  const m = METHODS[op.method];
  let days = m.waitDays + m.circDays;
  let dollars = KILL_MATERIALS;
  for (const [flag, key] of [[influx, 'influx'], [losses, 'losses'], [rekill, 'rekill']]) {
    if (flag) { days += PENALTY[key].days; dollars += PENALTY[key].dollars; }
  }
  op.done = true;
  op.result = { grade, rms: Math.round(rms), influx, losses, rekill, days: +days.toFixed(2), dollars, maxPit: Math.round(op.maxPit) };
  return op.result;
}

/** Skipping the mini-game: the company man runs Driller's method conservatively. */
export function companyManResult(sheet) {
  return {
    grade: 'C', rms: null, influx: false, losses: false, rekill: false, companyMan: true,
    days: METHODS.drillers.circDays + COMPANY_MAN.days, dollars: KILL_MATERIALS + COMPANY_MAN.dollars, maxPit: sheet.pitGain,
  };
}
