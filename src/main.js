import { createRig } from './rig.js';
import { h, setText, fmt } from './dom.js';
import { createRng, freshSeed } from './rng.js';
import { sound } from './audio.js';
import { cashFlowDiagram, scheduleChart, dial } from './charts.js';
import {
  RARITIES, ITEMS, BUNDLES, PITY, CRATE_COST_DBX, CRATE_COST_PETRODOLLARS, SCRAP_VALUE, itemById, legendaryChance,
  expectedPullsToLegendary, effectiveLegendaryRate, cheapestPurchase, bestDollarsPerCrate, expectedDollarsPerLegendary,
} from './economy.js';
import {
  formationAt, TARGET_DEPTH, RESERVOIR_TOP, CASING_POINTS, gradientToPpg, weakestFracGrad, hydrostatic, requiredAnnularVelocity,
  NOZZLES, PUMP_LIMIT_PSI, CHOKES, LIFTS, ooip, wellForecast, naturalFlowFactor, influxGradientFrom, influxType, influxHeight,
} from './reservoir.js';
import { METHODS, COMPANY_MAN, createKillOp, step as stepKill, setChoke as setKillChoke } from './wellcontrol.js';
import { HSE_EVENTS, WEATHER, SPILL } from './events.js';
import {
  newGame, reservoirOf, tickDrilling, tickProduction, drillingHydraulics, currentRop, chooseKillMethod, submitKillSheet,
  completeKill, useCompanyMan, resolveLosses, resolveStuck, resolveHse, resolveWeather, resolveWater, resolveSpill, acknowledge,
  completeWell, currentEur, setChoke, installLift, installWaterHandling, workover, shutIn, plugAndAbandon, nextField,
  buyBundle, openCrate, canOpen, equip, effect, validateSave, serialize, setMudWeight, setPumpRate, setNozzle,
  ACHIEVEMENTS, FIELDS_PER_CAMPAIGN, SCRAP_PER_CRATE, WORKOVER_COST, PA_COST, COMPLETION_COST, FACILITIES_COST, WATER_HANDLING_CAPEX, STUCK,
  DRILLING_DAMAGE_SKIN, BASE_PWF, campaignScore, rateCap,
} from './game.js';

const SAVE_KEY = 'drillbux-css.save.v2';
const HOURS_PER_SECOND = 20;
const DAYS_PER_SECOND = 18;
const DAY_CYCLE_SECONDS = 180;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ storage
function loadGame() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (raw) { const g = validateSave(raw); if (g) return g; }
  } catch { /* storage blocked */ }
  return newGame(freshSeed());
}
function saveGame() {
  try { window.localStorage.setItem(SAVE_KEY, serialize(game)); } catch { /* ignore */ }
}

let game = loadGame();
let priceRng = createRng(`${game.seed}:price:${game.fieldNo}:${Math.floor(game.project.days)}`);
sound.setEnabled(game.settings.sound);
const rarityColor = Object.fromEntries(RARITIES.map((r) => [r.id, r.color]));
const rarityLabel = Object.fromEntries(RARITIES.map((r) => [r.id, r.label]));

// ------------------------------------------------------------------ scene
const stage = document.getElementById('stage');
const rig = createRig(stage, { reducedMotion });
let xray = false;
let stormUntil = 0;

let cosmetics = {};
function applyCosmetics() {
  const skin = effect(game, 'cosmetic', 'skin3d', null);
  const flare = effect(game, 'cosmetic', 'flare', null);
  const hex = (n) => (n == null ? null : `#${n.toString(16).padStart(6, '0')}`);
  cosmetics = { derrick: hex(skin), flare: hex(flare), derrickGlow: skin === 0xff2bd6 };
  rig.setState({ ...sceneState(), ...cosmetics });
}
function sceneState() {
  const f = game.f;
  const fill = f.well ? Math.max(0, 1 - f.well.np / Math.max(1, currentEur(game))) : 1;
  return { drilling: f.phase === 'drilling' && f.drilling, producing: f.phase === 'production' && (f.well?.rate ?? 0) > 0, xray, oilFill: fill };
}

// ------------------------------------------------------------------ ui roots
const root = document.getElementById('app');
const refs = {};
const ref = (k) => (el) => { refs[k] = el; };
let activeTab = 'console';
let offerSeconds = 299;
let crateBusy = false;
let structureKey = '';

const btn = (label, onClick, { cls = 'btn', disabled = false, title, fk, pressed } = {}) =>
  h('button', { type: 'button', class: cls, disabled, title, dataset: fk ? { fk } : undefined, 'aria-pressed': pressed == null ? null : String(pressed), on: { click: (e) => { sound.click(); onClick(e); } } }, label);

function readout(label, key, extraCls = '') {
  return h('div', { class: `readout ${extraCls}` }, h('span', null, label), h('span', { class: 'num', ref: ref(key) }));
}
function kv(rows, cls = 'kv') {
  return h('table', { class: cls }, h('tbody', null, rows.filter(Boolean).map(([k, v]) => h('tr', null, h('th', { scope: 'row' }, k), h('td', { class: 'num' }, v)))));
}
function segmented(label, options, current, onPick, fk) {
  return h('div', { class: 'seg-wrap' },
    h('span', { class: 'seg-label' }, label),
    h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label },
      options.map(([value, text]) => h('button', {
        type: 'button', role: 'radio', class: 'seg-btn', 'aria-checked': String(value === current), dataset: { fk: `${fk}-${value}` },
        on: { click: () => { sound.click(); onPick(value); } },
      }, text))));
}

// ------------------------------------------------------------------ top bar
function chip(label, key, title) {
  return h('div', { class: 'chip', title }, h('span', { class: 'chip-label' }, label), h('span', { class: 'chip-value', ref: ref(key) }));
}

function topbar() {
  const unlocked = Object.keys(game.achievements).length;
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }),
      h('span', { class: 'brand-word' }, 'Drillbux'),
      h('span', { class: 'brand-ed' }, 'CSS Edition'),
    ),
    h('div', { class: 'field-pill', ref: ref('fieldPill') }),
    h('div', { class: 'chips' },
      chip('Field budget', 'budget', 'In-game dollars'),
      chip('Drillbux', 'dbx', 'Premium currency (simulated — no real money)'),
      chip('Scrap', 'scrap', 'From duplicate items'),
    ),
    h('div', { class: 'mode-switch', role: 'radiogroup', 'aria-label': 'Monetization mode' },
      [['aaa', 'AAA mode'], ['regulator', 'Regulator mode']].map(([id, label]) =>
        h('button', { type: 'button', role: 'radio', class: 'mode-btn', 'aria-checked': String(game.mode === id), on: { click: () => { game.mode = id; saveGame(); render(true); } } }, label))),
    h('div', { class: 'tools' },
      btn(game.settings.sound ? 'Sound on' : 'Sound off', () => { game.settings.sound = !game.settings.sound; sound.setEnabled(game.settings.sound); saveGame(); render(true); }, { cls: 'tool', pressed: game.settings.sound }),
      btn(game.settings.graphics === 'low' ? 'Graphics: low' : 'Graphics: high', () => { setGraphics(game.settings.graphics === 'low' ? 'high' : 'low'); saveGame(); render(true); }, { cls: 'tool' }),
      btn(game.settings.tutorial ? 'Tips on' : 'Tips off', () => { game.settings.tutorial = !game.settings.tutorial; saveGame(); render(true); }, { cls: 'tool', pressed: game.settings.tutorial }),
      btn(`Achievements ${unlocked}/${ACHIEVEMENTS.length}`, showAchievements, { cls: 'tool' }),
      btn('New campaign', confirmNewCampaign, { cls: 'tool' }),
    ),
  );
}

// ------------------------------------------------------------------ console: drilling
function consoleDrilling() {
  const f = game.f;
  const shoeLabel = f.shoe ? `${fmt.int(f.shoe)} ft` : 'none yet';
  refs.sppDial = dial({ label: 'Standpipe pressure', unit: 'psi', max: 5000, red: PUMP_LIMIT_PSI });
  return [
    h('div', { class: 'depth-row' },
      h('div', { class: 'gauge' }, h('span', { class: 'gauge-value', ref: ref('depth') }), h('span', { class: 'gauge-unit' }, 'ft MD'), h('span', { class: 'gauge-label', ref: ref('formation') })),
      refs.sppDial.el,
    ),
    h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Depth to target', 'aria-valuemin': '0', 'aria-valuemax': String(TARGET_DEPTH), ref: ref('depthBar') },
      h('div', { class: 'progress-fill', ref: ref('depthFill') }),
      ...CASING_POINTS.map((c) => h('div', { class: `progress-mark${f.shoe >= c.depth ? ' is-set' : ''}`, css: { left: `${(c.depth / TARGET_DEPTH) * 100}%` }, title: c.name })),
      h('div', { class: 'progress-mark res', css: { left: `${(RESERVOIR_TOP / TARGET_DEPTH) * 100}%` }, title: 'Top of reservoir' })),
    h('div', { class: 'readouts-2' },
      readout('ROP', 'rop'), readout('Bit', 'bitName'), readout('Casing shoe', 'shoe'), readout('ECD', 'ecd'),
    ),
    h('div', { class: 'control' },
      h('label', { for: 'mw', class: 'control-label' }, 'Mud weight ', h('strong', { ref: ref('mwVal') })),
      h('input', { id: 'mw', type: 'range', min: '8.6', max: '17', step: '0.1', value: String(f.mudWeight), dataset: { fk: 'mw' },
        on: { input: (e) => setMudWeight(game, +e.target.value) }, ref: ref('mwInput') }),
      h('div', { class: 'window', 'aria-hidden': 'true' },
        h('div', { class: 'window-safe', ref: ref('windowSafe') }),
        h('div', { class: 'needle needle-mw', ref: ref('needleMw'), title: 'Static mud weight' }),
        h('div', { class: 'needle needle-ecd', ref: ref('needleEcd'), title: 'ECD while circulating' })),
      h('p', { class: 'hint', ref: ref('windowText') }),
    ),
    h('div', { class: 'control' },
      h('label', { for: 'pump', class: 'control-label' }, 'Pump rate ', h('strong', { ref: ref('pumpVal') })),
      h('input', { id: 'pump', type: 'range', min: '250', max: '750', step: '25', value: String(f.pumpRate), dataset: { fk: 'pump' },
        on: { input: (e) => setPumpRate(game, +e.target.value) }, ref: ref('pumpInput') }),
    ),
    segmented('Bit nozzles', Object.entries(NOZZLES).map(([k, n]) => [k, n.label]), f.nozzle, (k) => setNozzle(game, k), 'noz'),
    h('div', { class: 'meters' },
      meter('Annular velocity', 'av'),
      meter('Cuttings in hole', 'cut'),
    ),
    h('p', { class: 'hint alarm', ref: ref('pumpAlarm') }),
    h('div', { class: 'actions' },
      btn('', () => { game.f.drilling = !game.f.drilling; if (game.f.drilling) game.f.pumpAlarm = false; }, { cls: 'btn btn-primary', fk: 'drill' }),
      xrayButton(),
    ),
    h('p', { class: 'hint' }, `Shoe: ${shoeLabel}. Casing is run automatically at ${CASING_POINTS.map((c) => fmt.int(c.depth)).join(' and ')} ft.`),
  ];
}

function meter(label, key) {
  return h('div', { class: 'meter' },
    h('div', { class: 'meter-head' }, h('span', null, label), h('span', { class: 'num', ref: ref(`${key}Text`) })),
    h('div', { class: 'meter-track' }, h('div', { class: 'meter-fill', ref: ref(`${key}Fill`) }), h('div', { class: 'meter-mark', ref: ref(`${key}Mark`) })));
}

function xrayButton() {
  return btn('Subsurface view', (e) => { xray = !xray; e.currentTarget.setAttribute('aria-pressed', String(xray)); rig.setState(sceneState()); }, { cls: 'btn', pressed: xray, fk: 'xray' });
}

// ------------------------------------------------------------------ console: completion
function consoleCompletion() {
  const r = reservoirOf(game);
  const skin = DRILLING_DAMAGE_SKIN + effect(game, 'completion', 'skin', 0);
  const pwf = BASE_PWF - effect(game, 'eor', 'pwfDrop', 0);
  const fc = wellForecast(r, { skin, recoveryBonus: effect(game, 'eor', 'recovery', 0), pwf });
  const cap = rateCap(game, fc.eur);
  return [
    h('p', { class: 'lede' }, 'Target depth reached. Equip a completion or EOR item from the store to improve the forecast, then complete the well and tie it back to the production facilities.'),
    kv([
      ['Area', `${r.area} acres`], ['Net pay', `${r.thickness} ft`], ['Porosity', fmt.pct(r.porosity)], ['Water saturation', fmt.pct(r.sw)],
      ['Bo', `${r.bo} rb/STB`], ['Permeability', `${r.k} md`], ['Viscosity', `${r.mu} cp`], ['Reservoir pressure', `${fmt.int(r.pr)} psia`],
      ['OOIP', fmt.bbl(ooip(r))],
    ]),
    h('h3', { class: 'sub' }, 'Forecast with current equipment'),
    kv([
      ['Skin', `${skin.toFixed(1)}${game.equipped.completion ? ` (${itemById(game.equipped.completion).name})` : ' (drilling damage)'}`],
      ['Well deliverability (Darcy)', `${fmt.int(fc.qi)} STB/d`],
      ['Reserves-limited rate', `${fmt.int(cap)} STB/d`],
      ['Initial rate', `${fmt.int(Math.min(fc.qi, cap))} STB/d — ${fc.qi < cap ? 'deliverability-limited: stimulation helps' : 'reserves-limited: EOR helps more than stimulation'}`],
      ['Recovery factor', fmt.pct(fc.recoveryFactor)],
      ['EUR', fmt.bbl(fc.eur)],
    ]),
    h('div', { class: 'actions' }, btn(`Complete well & tie back (${fmt.money(COMPLETION_COST + FACILITIES_COST)})`, () => { completeWell(game); sound.good(); saveGame(); render(true); }, { cls: 'btn btn-primary' }), xrayButton()),
  ];
}

// ------------------------------------------------------------------ console: production
function consoleProduction() {
  const w = game.f.well;
  const liftCards = Object.entries(LIFTS).map(([k, l]) => {
    const installed = w.lift === k;
    const canInstall = k !== 'natural' && !installed;
    return h('div', { class: `lift${installed ? ' is-on' : ''}` },
      h('div', { class: 'lift-head' }, h('strong', null, l.label), installed ? h('span', { class: 'tag' }, 'Installed') : null),
      h('p', { class: 'lift-blurb' }, l.blurb),
      k !== 'natural' ? h('p', { class: 'lift-cost' }, `${fmt.money(l.capex)} + ${fmt.money(l.opexDay)}/day`) : null,
      canInstall ? btn('Install', () => { if (installLift(game, k)) { sound.cash(); toast(`${l.label} installed.`); saveGame(); } }, { cls: 'btn btn-small', fk: `lift-${k}` }) : null,
    );
  });
  return [
    h('div', { class: 'depth-row' },
      h('div', { class: 'gauge' }, h('span', { class: 'gauge-value', ref: ref('rate') }), h('span', { class: 'gauge-unit' }, 'STB/d oil'), h('span', { class: 'gauge-label', ref: ref('water') })),
    ),
    meter('Water cut', 'wc'),
    meter('Cumulative / EUR', 'np'),
    h('div', { class: 'readouts-2' },
      readout('Recovery factor', 'rf'), readout('Skin', 'skin'), readout('Reservoir drive', 'drive'), readout('Cash flow', 'fieldCash'),
    ),
    segmented('Choke (bean size)', Object.entries(CHOKES).map(([k, c]) => [k, c.label]), w.choke, (k) => setChoke(game, k), 'choke'),
    h('p', { class: 'hint' }, 'A bigger choke produces more now but drains pressure faster, so the well declines sooner.'),
    h('h3', { class: 'sub' }, 'Artificial lift'),
    h('div', { class: 'lifts' }, liftCards),
    h('h3', { class: 'sub' }, 'Water'),
    h('p', { class: 'hint' }, w.waterHandling ? 'Produced-water treatment installed: $0.80/bbl.' : 'Water is trucked away: $2.50/bbl.'),
    h('div', { class: 'actions' },
      !w.waterHandling ? btn(`Install water treatment (${fmt.money(WATER_HANDLING_CAPEX)})`, () => { if (installWaterHandling(game)) { sound.cash(); saveGame(); } }, { cls: 'btn btn-small' }) : null,
      btn(`Workover (${fmt.money(WORKOVER_COST)})`, () => { if (!workover(game)) toast('Equip a better completion item first.'); else { toast('Workover done. Skin reduced.'); saveGame(); } }, { cls: 'btn btn-small', title: 'Re-stimulate with your equipped completion item' }),
      btn('Shut in & abandon', () => { shutIn(game); saveGame(); render(true); }, { cls: 'btn btn-small btn-quiet' }),
      xrayButton(),
    ),
  ];
}

function consoleAbandon() {
  const w = game.f.well;
  return [
    h('p', { class: 'lede' }, w ? 'The well is off production. Plug it with cement barriers and abandon it before moving the rig.' : 'Plug and abandon the well before moving the rig.'),
    w ? kv([['Cumulative oil', fmt.bbl(w.np)], ['Recovery factor', fmt.pct(w.np / w.ooip)]]) : null,
    h('div', { class: 'actions' }, btn(`Plug & abandon (${fmt.money(PA_COST)}, 6 days)`, () => { plugAndAbandon(game); sound.good(); saveGame(); render(true); showReport(); }, { cls: 'btn btn-primary' })),
  ];
}

function consoleReport() {
  return [
    h('p', { class: 'lede' }, `Field ${game.fieldNo} is closed out.`),
    h('div', { class: 'actions' }, btn('View field report', showReport, { cls: 'btn btn-primary' })),
  ];
}

function consolePanel() {
  const titles = { drilling: 'Drilling', completion: 'Completion', production: 'Production', abandon: 'Abandonment', report: 'Field closed' };
  const body = { drilling: consoleDrilling, completion: consoleCompletion, production: consoleProduction, abandon: consoleAbandon, report: consoleReport }[game.f.phase]();
  return h('section', { class: 'panel console', id: 'panel-console', 'aria-label': "Driller's console" },
    h('h2', { class: 'panel-title' }, titles[game.f.phase]), ...body);
}

// ------------------------------------------------------------------ store
function storePanel() {
  const aaa = game.mode === 'aaa';
  return h('section', { class: 'panel store', id: 'panel-store', 'aria-label': 'Crate store' },
    aaa
      ? h('div', { class: 'offer' },
        h('span', { class: 'offer-badge' }, 'Limited offer'),
        h('h2', { class: 'offer-title' }, 'Legendary Rig Crate'),
        h('p', { class: 'offer-timer' }, 'Ends in ', h('strong', { ref: ref('timer') })))
      : h('h2', { class: 'panel-title' }, 'Rig crate'),
    h('div', { class: 'crate-actions' },
      btn(aaa ? `Open now · ${CRATE_COST_DBX}` : `Open for ${CRATE_COST_DBX} Drillbux (≈ ${fmt.usd(bestDollarsPerCrate())})`, () => tryOpen('dbx'), { cls: 'btn btn-crate', fk: 'open-dbx' }),
      btn(`Open for ${fmt.money(CRATE_COST_PETRODOLLARS)} field budget`, () => tryOpen('budget'), { cls: 'btn', fk: 'open-budget' }),
      btn(`Open for ${SCRAP_PER_CRATE} scrap`, () => tryOpen('scrap'), { cls: 'btn', fk: 'open-scrap' }),
      btn(aaa ? 'Get more Drillbux!' : 'Buy Drillbux (simulated)', () => openShop(), { cls: aaa ? 'btn btn-shop' : 'btn' }),
    ),
    aaa ? btn('Odds and info', () => showModal({ key: 'odds', title: 'Odds and info', body: truthBlock(), actions: [btn('Close', closeModal, { cls: 'btn btn-primary' })] }), { cls: 'linklike' }) : truthBlock(),
    h('h3', { class: 'sub' }, 'Equipment'),
    inventoryList(),
  );
}

function inventoryList() {
  const owned = ITEMS.filter((i) => game.inventory[i.id]);
  if (!owned.length) return h('p', { class: 'hint' }, 'No equipment yet. Crates hold drill bits, completions, EOR methods and cosmetics.');
  const slotName = { bit: 'bit', completion: 'completion', eor: 'EOR', cosmetic: 'cosmetic' };
  return h('ul', { class: 'inv' }, owned.map((i) => {
    const on = game.equipped[i.slot] === i.id;
    return h('li', { class: 'inv-item', css: { '--rar': rarityColor[i.rarity] } },
      h('div', { class: 'inv-main' },
        h('span', { class: 'inv-name' }, i.name, game.inventory[i.id] > 1 ? ` ×${game.inventory[i.id]}` : ''),
        h('span', { class: 'inv-meta' }, `${rarityLabel[i.rarity]} ${slotName[i.slot]} — ${effectText(i)}`)),
      btn(on ? 'Equipped' : 'Equip', () => { equip(game, i.id); applyCosmetics(); saveGame(); render(true); }, { cls: 'btn btn-small', pressed: on, fk: `eq-${i.id}` }));
  }));
}

function effectText(i) {
  const e = i.effect;
  if (e.rop) return `ROP ×${e.rop}`;
  if (e.skin) return `skin ${e.skin}`;
  if (e.recovery) return `RF +${Math.round(e.recovery * 100)} pts${e.pwfDrop ? `, Pwf −${e.pwfDrop} psi` : ''}`;
  return 'no gameplay effect';
}

function truthBlock() {
  return h('div', { class: 'truth' },
    h('table', { class: 'odds' }, h('caption', null, 'Published odds per crate'),
      h('tbody', null, RARITIES.map((r) => h('tr', null, h('th', { scope: 'row', css: { color: r.color } }, r.label), h('td', { class: 'num' }, fmt.pct(r.odds, 1)))))),
    kv([
      ['Pity counter', `${game.pity} / ${PITY.hard}`],
      ['Next legendary chance', fmt.pct(legendaryChance(game.pity + 1), 1)],
      ['Expected crates per legendary', expectedPullsToLegendary().toFixed(1)],
      ['Effective legendary rate', fmt.pct(effectiveLegendaryRate(), 2)],
      ['Expected cost per legendary', fmt.usd(expectedDollarsPerLegendary())],
      ['Crates opened', fmt.int(game.cratesOpened)],
      ['Simulated money spent', fmt.usd(game.realSpent)],
      ['Offer timer resets', fmt.int(game.timerResets)],
    ]),
    h('p', { class: 'hint' }, 'All purchases are simulated. This project has no payment code and cannot charge anyone.'),
  );
}

// ------------------------------------------------------------------ modal
const dialog = h('dialog', { class: 'modal', 'aria-labelledby': 'modal-title' });
document.body.append(dialog);
let modalKey = null;
let modalTick = null; // per-frame callback for live modals

function showModal({ key, title, body, actions = [], cls = '' }) {
  modalKey = key;
  modalTick = null;
  dialog.className = `modal ${cls}`;
  dialog.replaceChildren(
    h('h2', { id: 'modal-title' }, title),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('div', { class: 'modal-actions' }, actions) : null,
  );
  if (!dialog.open) dialog.showModal();
  const first = dialog.querySelector('input, button.btn-primary, button');
  first?.focus();
}
function closeModal() { modalKey = null; modalTick = null; if (dialog.open) dialog.close(); }
dialog.addEventListener('cancel', (e) => { if (game.event || modalKey === 'kill') e.preventDefault(); else { modalKey = null; modalTick = null; } });

// ------------------------------------------------------------------ events → modals
function renderEvent() {
  const e = game.event;
  if (!e) return;
  const key = `${e.type}:${e.stage ?? ''}:${e.id ?? ''}`;
  if (dialog.open && modalKey === key) return;
  sound.drilling(false);
  ({
    kick: renderKick, 'kill-result': renderKillResult, losses: renderLosses, stuck: renderStuck, hse: renderHse,
    weather: renderWeather, water: renderWater, spill: renderSpill, outcome: renderOutcome,
  })[e.type]?.(e, key);
}

function after(fn) {
  return () => { fn(); saveGame(); closeModal(); render(true); };
}

function renderKick(e, key) {
  if (e.stage === 'shut-in') return renderShutIn(e, key);
  if (e.stage === 'sheet') return renderSheet(e, key);
  if (e.stage === 'choke') return renderChoke(e, key);
}

function renderShutIn(e, key) {
  sound.alarm();
  const sh = e.sheet;
  const grad = influxGradientFrom(sh.sidpp, sh.sicp, sh.omw, sh.pitGain);
  showModal({
    key, cls: 'modal-wide modal-wc', title: 'Kick — well shut in',
    body: [
      h('p', { class: 'lede' }, `Pit gain detected at ${fmt.int(sh.depth)} ft in the ${formationAt(sh.depth).name}. The driller spaced out, stopped the pumps and closed the BOP.`),
      h('div', { class: 'wc-grid' },
        h('div', { class: 'wc-card' }, h('h3', null, 'Shut-in data'), kv([
          ['Pit gain', `${sh.pitGain} bbl`], ['SIDPP', `${fmt.int(sh.sidpp)} psi`], ['SICP', `${fmt.int(sh.sicp)} psi`],
          ['TVD', `${fmt.int(sh.depth)} ft`], ['Original mud weight', `${sh.omw.toFixed(1)} ppg`],
          ['Shoe', sh.shoeDepth ? `${fmt.int(sh.shoeDepth)} ft` : 'none'], ['MAASP', Number.isFinite(sh.maasp) ? `${fmt.int(sh.maasp)} psi` : '—'],
          ['Slow circulating rate', `${fmt.int(sh.scr)} psi @ 30 spm`], ['Surface → bit', `${fmt.int(sh.toBit)} strokes`], ['Bit → surface', `${fmt.int(sh.bottomsUp)} strokes`],
        ])),
        h('div', { class: 'wc-card' }, h('h3', null, 'What came in?'),
          h('p', { class: 'eq' }, `Influx height = ${sh.pitGain} bbl ÷ 0.0459 bbl/ft = ${fmt.int(influxHeight(sh.pitGain))} ft`),
          h('p', { class: 'eq' }, `Gradient = 0.052 × ${sh.omw.toFixed(1)} − (${fmt.int(sh.sicp)} − ${fmt.int(sh.sidpp)}) ÷ ${fmt.int(influxHeight(sh.pitGain))} = ${grad.toFixed(2)} psi/ft`),
          h('p', { class: 'verdict' }, `Likely influx: ${influxType(grad)}`),
          h('p', { class: 'hint' }, 'Under 0.25 psi/ft is gas, 0.25–0.4 oil or mixed, over 0.4 salt water.')),
      ),
      h('h3', { class: 'sub' }, 'Choose a kill method'),
      h('div', { class: 'methods' }, Object.entries(METHODS).map(([k, m]) => h('button', {
        type: 'button', class: 'method', on: { click: () => { sound.click(); chooseKillMethod(game, k); renderEvent(); } },
      }, h('strong', null, m.label), h('span', null, m.blurb), h('span', { class: 'method-time' }, `${m.waitDays + m.circDays} rig days`)))),
    ],
    actions: [btn(`Hand over to the company man (+${fmt.money(COMPANY_MAN.dollars)}, +${COMPANY_MAN.days} day)`, () => { useCompanyMan(game); renderEvent(); }, { cls: 'btn btn-quiet' })],
  });
}

function renderSheet(e, key) {
  const sh = e.sheet;
  const inputs = {};
  const field = (id, label, formula, unit) => h('div', { class: 'ks-row' },
    h('label', { for: `ks-${id}`, class: 'ks-label' }, h('strong', null, label), h('span', { class: 'ks-formula' }, formula)),
    h('div', { class: 'ks-input' }, h('input', { id: `ks-${id}`, type: 'number', inputmode: 'decimal', step: id === 'kmw' ? '0.1' : '1', ref: (el) => { inputs[id] = el; }, autocomplete: 'off' }), h('span', null, unit)));
  const start = (assisted) => {
    if (assisted) { inputs.kmw.value = sh.kmw.toFixed(1); inputs.icp.value = String(sh.icp); inputs.fcp.value = String(sh.fcp); }
    const entered = { kmw: parseFloat(inputs.kmw.value), icp: parseFloat(inputs.icp.value), fcp: parseFloat(inputs.fcp.value) };
    if (![entered.kmw, entered.icp, entered.fcp].every(Number.isFinite)) { toast('Fill in all three values, or use the worked solution.'); return; }
    submitKillSheet(game, entered, assisted);
    renderEvent();
  };
  showModal({
    key, cls: 'modal-wide modal-sheet', title: `Kill sheet — ${METHODS[e.method].label}`,
    body: [
      h('div', { class: 'ks-paper' },
        h('div', { class: 'ks-head' },
          h('span', null, 'Well: DRILLBUX-1'), h('span', null, `Field ${game.fieldNo}`), h('span', null, `TVD ${fmt.int(sh.depth)} ft`)),
        kv([['SIDPP', `${fmt.int(sh.sidpp)} psi`], ['OMW', `${sh.omw.toFixed(1)} ppg`], ['SCR @ 30 spm', `${fmt.int(sh.scr)} psi`], ['TVD', `${fmt.int(sh.depth)} ft`]], 'kv ks-given'),
        field('kmw', 'Kill mud weight', 'KMW = OMW + SIDPP ÷ (0.052 × TVD), round up to 0.1', 'ppg'),
        field('icp', 'Initial circulating pressure', 'ICP = SCR + SIDPP', 'psi'),
        field('fcp', 'Final circulating pressure', 'FCP = SCR × KMW ÷ OMW', 'psi'),
        h('p', { class: 'hint' }, 'You will hold drill-pipe pressure on the schedule from your own sheet. If your numbers are wrong, following them perfectly still puts the wrong pressure on bottom.'),
      ),
    ],
    actions: [
      btn('Show worked solution', () => start(true), { cls: 'btn btn-quiet' }),
      btn('Check sheet & go to choke', () => start(false), { cls: 'btn btn-primary' }),
    ],
  });
}

function renderChoke(e, key) {
  const op = createKillOp({ sheet: e.sheet, entered: e.entered, method: e.method });
  const dpp = dial({ label: 'Drill pipe', unit: 'psi', max: Math.ceil(Math.max(op.sheet.icp, op.entered.icp) * 1.6 / 500) * 500 });
  const maaspOk = Number.isFinite(op.sheet.maasp);
  const cpd = dial({ label: 'Casing', unit: 'psi', max: Math.ceil(Math.max(maaspOk ? op.sheet.maasp : 0, op.sheet.sicp * 2) * 1.2 / 500) * 500, red: maaspOk ? op.sheet.maasp : null });
  const chart = scheduleChart(op);
  const c = {};
  const check = e.check;
  let running = false;
  const slider = h('input', { type: 'range', min: '0', max: '100', step: '0.5', value: '50', class: 'choke-slider', 'aria-label': 'Choke opening, percent',
    on: { input: (ev) => setKillChoke(op, +ev.target.value) } });
  const keyHandler = (ev) => {
    if (!running) return;
    const d = { ArrowUp: 1.5, KeyW: 1.5, ArrowDown: -1.5, KeyS: -1.5, PageUp: 6, PageDown: -6 }[ev.code];
    if (d != null) { setKillChoke(op, op.choke + d); slider.value = String(op.choke); ev.preventDefault(); }
  };
  showModal({
    key, cls: 'modal-wide modal-choke', title: 'Remote choke panel',
    body: [
      check && !check.allOk ? h('p', { class: 'banner banner-warn' }, `Your sheet differs from the correct one (${[!check.kmwOk && 'KMW', !check.icpOk && 'ICP', !check.fcpOk && 'FCP'].filter(Boolean).join(', ')}). You'll follow your own schedule anyway.`) : null,
      h('div', { class: 'choke-grid' },
        h('div', { class: 'choke-gauges' }, dpp.el, cpd.el),
        h('div', { class: 'choke-center' },
          chart.el,
          h('div', { class: 'choke-status' },
            h('span', { class: 'lamp', ref: (el) => { c.lamp = el; } }, 'BHP'),
            h('span', { ref: (el) => { c.phase = el; } }),
            h('span', { class: 'num', ref: (el) => { c.strokes = el; } })),
          h('p', { class: 'hint' }, 'Hold the drill-pipe needle (white) on the target needle (yellow). Open the choke to lower pressure, close it to raise pressure. Keys: ↑/W open, ↓/S close.')),
        h('div', { class: 'choke-ctrl' },
          h('span', { class: 'choke-cap' }, 'Open'),
          slider,
          h('span', { class: 'choke-cap' }, 'Closed'),
          h('strong', { class: 'num', ref: (el) => { c.chokePct = el; } }, '50%')),
      ),
    ],
    actions: [
      btn('Start pumping', (ev) => {
        if (running) return;
        running = true;
        ev.currentTarget.disabled = true;
        slider.focus();
        sound.good();
      }, { cls: 'btn btn-primary' }),
    ],
  });
  window.addEventListener('keydown', keyHandler);
  dpp.set(op.dpp, targetNow(op));
  cpd.set(op.cp);
  modalTick = (dt) => {
    if (!running || op.done) return;
    for (let left = dt; left > 1e-6 && !op.done; left -= 0.05) stepKill(op, Math.min(0.05, left));
    const tgt = targetNow(op);
    dpp.set(op.dpp, tgt);
    cpd.set(op.cp);
    chart.update(op);
    setText(c.chokePct, `${Math.round(op.choke)}%`);
    setText(c.strokes, `${fmt.int(op.strokes)} / ${fmt.int(op.total)} strokes`);
    setText(c.phase, op.phases.length > 1 ? (op.strokes < op.phases[0].strokes ? 'Circulation 1 of 2' : 'Circulation 2 of 2') : 'Kill circulation');
    const state = op.err < -150 ? 'under' : (op.cp > op.sheet.maasp || op.err > 350) ? 'over' : Math.abs(op.err) < 60 ? 'good' : 'drift';
    c.lamp.className = `lamp lamp-${state}`;
    setText(c.lamp, { under: 'BHP LOW — influx', over: 'OVER — losses risk', good: 'BHP on target', drift: 'BHP drifting' }[state]);
    if (op.done) {
      window.removeEventListener('keydown', keyHandler);
      completeKill(game, op.result);
      op.result.grade === 'A' || op.result.grade === 'B' ? sound.good() : sound.bad();
      saveGame();
      renderEvent();
    }
  };
}

function targetNow(op) {
  const { phase, s } = (() => { let acc = 0; for (const p of op.phases) { if (op.strokes < acc + p.strokes || p === op.phases[op.phases.length - 1]) return { phase: p, s: op.strokes - acc }; acc += p.strokes; } })();
  if (!phase.killMud) return op.entered.icp;
  return s < op.sheet.toBit ? op.entered.icp + (op.entered.fcp - op.entered.icp) * (s / op.sheet.toBit) : op.entered.fcp;
}

function renderKillResult(e, key) {
  const r = e.result;
  const sh = e.sheet;
  showModal({
    key, cls: 'modal-wide', title: r.companyMan ? 'Well killed by the company man' : 'Well killed',
    body: [
      h('div', { class: 'grade-row' },
        h('div', { class: `grade grade-${r.grade}` }, r.grade),
        h('div', null,
          h('p', { class: 'lede' }, r.companyMan ? 'A conservative Driller’s method kill. Safe, slow and expensive.'
            : r.grade === 'A' ? 'Textbook. Bottom-hole pressure barely moved.' : r.grade === 'B' ? 'Good choke work with small excursions.' : r.grade === 'C' ? 'Killed, but pressure wandered.' : 'The well is dead, but it cost you.'),
          r.rms != null ? h('p', { class: 'hint' }, `RMS bottom-hole pressure error: ${r.rms} psi`) : null)),
      h('ul', { class: 'flags' },
        r.influx ? h('li', null, 'Secondary influx: pressure fell below pore pressure and more fluid came in.') : null,
        r.losses ? h('li', null, 'Losses: casing pressure exceeded MAASP and fractured the shoe.') : null,
        r.rekill ? h('li', null, 'Kill mud was too light. The well flowed on the check and had to be killed again.') : null),
      kv([
        ['Correct KMW / ICP / FCP', `${sh.kmw.toFixed(1)} ppg / ${fmt.int(sh.icp)} psi / ${fmt.int(sh.fcp)} psi`],
        ['Rig time', `${r.days} days`], ['Cost (materials & extras)', fmt.money(r.dollars)], ['New mud weight', `${game.f.mudWeight.toFixed(1)} ppg`],
      ]),
    ],
    actions: [btn('Resume operations', after(() => acknowledge(game)), { cls: 'btn btn-primary' })],
  });
}

function renderLosses(e, key) {
  sound.alarm();
  showModal({
    key, title: 'Lost circulation',
    body: [
      h('p', null, `Circulating density reached ${e.ecd.toFixed(2)} ppg at ${fmt.int(e.depth)} ft. That's above the weakest open-hole fracture gradient (${e.maxPpg.toFixed(2)} ppg). Mud is flowing into the formation.`),
      h('p', { class: 'hint' }, 'Losses cost $400k and half a rig day. Lower the ECD by reducing mud weight, pump rate, or both.'),
    ],
    actions: [
      btn('Cut mud weight', after(() => resolveLosses(game, 'mw')), { cls: 'btn' }),
      btn('Reduce pump rate & pump LCM', after(() => resolveLosses(game, 'rate')), { cls: 'btn btn-primary' }),
    ],
  });
}

function renderStuck(e, key) {
  sound.bad();
  showModal({
    key, title: 'Stuck pipe — pack-off',
    body: [
      h('p', null, 'Cuttings built up around the bottom-hole assembly because annular velocity was too low for the rate of penetration. The string won’t rotate or pull free.'),
      e.jarTried ? h('p', { class: 'banner banner-warn' }, 'Jarring failed. The only option left is to back off and sidetrack.') : null,
    ],
    actions: [
      !e.jarTried ? btn(`Jar it free (60% chance, ${fmt.money(STUCK.jar.dollars)}, 1 day)`, () => { const res = resolveStuck(game, 'jar'); saveGame(); if (res === 'freed') { toast('Pipe freed. Keep the flow rate up.'); closeModal(); render(true); } else renderEvent(); }, { cls: 'btn' }) : null,
      btn(`Back off & sidetrack (${fmt.money(STUCK.sidetrack.dollars)}, 6 days, lose 400 ft)`, after(() => resolveStuck(game, 'sidetrack')), { cls: 'btn btn-primary' }),
    ],
  });
}

function permitCard(title, body) {
  return h('div', { class: 'permit' }, h('div', { class: 'permit-stripe' }), h('h3', null, title), h('p', null, body));
}

function renderHse(e, key) {
  const ev = HSE_EVENTS.find((x) => x.id === e.id);
  sound.alarm();
  showModal({
    key, cls: 'modal-hse', title: 'HSE — your call',
    body: [permitCard(ev.title, ev.body), h('p', { class: 'hint' }, 'Stopping the job costs a little time. Carrying on is usually fine — until it isn’t.')],
    actions: [
      btn(ev.risky.label, after(() => { const r = resolveHse(game, 'risky'); if (r?.incident) sound.bad(); }), { cls: 'btn btn-quiet' }),
      btn(ev.safe.label, after(() => resolveHse(game, 'safe')), { cls: 'btn btn-primary' }),
    ],
  });
}

function renderWeather(e, key) {
  stormUntil = performance.now() + 60_000;
  rig.setStorm(true);
  showModal({
    key, cls: 'modal-met', title: 'Met bulletin',
    body: [h('div', { class: 'met' }, h('h3', null, WEATHER.title), h('p', null, WEATHER.body),
      kv([['Wind', '45–55 kn, gusting 65'], ['Significant wave height', '6.0 m'], ['Window', 'Next 24 hours']]))],
    actions: [
      btn(WEATHER.risky.label, after(() => { const r = resolveWeather(game, 'risky'); stormUntil = performance.now() + 8000; if (r?.incident) sound.bad(); }), { cls: 'btn btn-quiet' }),
      btn(WEATHER.safe.label, after(() => { const r = resolveWeather(game, 'wait'); stormUntil = performance.now() + 8000; toast(`Waited ${r.days.toFixed(1)} days on weather.`); }), { cls: 'btn btn-primary' }),
    ],
  });
}

function renderWater(e, key) {
  showModal({
    key, title: 'Water breakthrough',
    body: [h('p', null, 'The water front has reached the well. Water cut will keep rising as the reservoir depletes.'),
      kv([['Trucked disposal', `${'$2.50'}/bbl water`], ['With treatment plant', `$0.80/bbl water + ${fmt.money(WATER_HANDLING_CAPEX)} capex`]])],
    actions: [
      btn('Shut in now', after(() => resolveWater(game, 'shut-in')), { cls: 'btn btn-quiet' }),
      btn('Keep trucking water', after(() => resolveWater(game, 'truck')), { cls: 'btn' }),
      btn('Install water treatment', after(() => resolveWater(game, 'handle')), { cls: 'btn btn-primary' }),
    ],
  });
}

function renderSpill(e, key) {
  sound.alarm();
  showModal({
    key, cls: 'modal-wide', title: SPILL.title,
    body: [h('p', null, SPILL.body), h('div', { class: 'methods' }, SPILL.options.map((o) => h('button', {
      type: 'button', class: 'method', on: { click: after(() => resolveSpill(game, o.id)) },
    }, h('strong', null, o.label), h('span', null, o.blurb), h('span', { class: 'method-time' }, o.dollars ? `${fmt.money(o.dollars)}, ${o.days} days` : 'Free — for now'))))],
  });
}

function renderOutcome(e, key) {
  sound.bad();
  showModal({ key, title: e.title, body: h('p', null, e.text), actions: [btn('Continue', after(() => acknowledge(game)), { cls: 'btn btn-primary' })] });
}

// ------------------------------------------------------------------ report & campaign
function showReport() {
  const r = game.f.report;
  if (!r) return;
  const last = game.fieldNo >= FIELDS_PER_CAMPAIGN;
  showModal({
    key: 'report', cls: 'modal-wide modal-report', title: `Field ${r.fieldNo} — economics report`,
    body: [
      h('div', { class: 'kpis' },
        kpi('NPV @ 10%', fmt.money(r.npv), r.npv >= 0 ? 'pos' : 'neg'),
        kpi('IRR', r.irr == null ? 'n/a' : fmt.pct(r.irr), r.irr != null && r.irr > 0.1 ? 'pos' : 'neg'),
        kpi('Payback', r.payback == null ? 'never' : `${r.payback.toFixed(1)} yr`),
        kpi('Profitability index', r.pi == null ? 'n/a' : r.pi.toFixed(2)),
      ),
      cashFlowDiagram(r.cashflows),
      h('div', { class: 'report-cols' },
        kv([['Capex', fmt.money(r.capex)], ['Revenue (after royalty)', fmt.money(r.revenue)], ['Opex', fmt.money(r.opex)],
          ['Crate spend (field budget)', fmt.money(r.crateSpend)], ['NPV without crates', fmt.money(r.npvNoCrates)]]),
        kv([['Cumulative oil', fmt.bbl(r.np)], ['OOIP', fmt.bbl(r.ooip)], ['Recovery factor', fmt.pct(r.recovery)], ['Kicks', String(r.kicks)], ['HSE incidents', String(r.incidents)]]),
      ),
      r.crateSpend > 0 ? h('p', { class: 'banner' }, `Crates cost this field ${fmt.money(r.npvNoCrates - r.npv)} of NPV.`) : null,
    ],
    actions: [btn(last ? 'Finish campaign' : `Move rig to field ${game.fieldNo + 1} (${fmt.money(2_500_000)}, 14 days)`, () => {
      nextField(game);
      priceRng = createRng(`${game.seed}:price:${game.fieldNo}`);
      saveGame();
      closeModal();
      render(true);
      if (game.campaignOver) showCampaignEnd();
    }, { cls: 'btn btn-primary' })],
  });
}

function kpi(label, value, tone = '') {
  return h('div', { class: `kpi ${tone}` }, h('span', { class: 'kpi-value' }, value), h('span', { class: 'kpi-label' }, label));
}

function showCampaignEnd() {
  const score = campaignScore(game);
  sound.fanfare();
  showModal({
    key: 'campaign', cls: 'modal-wide modal-report', title: 'Campaign complete',
    body: [
      h('div', { class: 'kpis' },
        kpi('Score (project NPV)', fmt.money(score), score >= 0 ? 'pos' : 'neg'),
        kpi('Best score', fmt.money(game.best ?? score)),
        kpi('Simulated money spent', fmt.usd(game.realSpent)),
        kpi('Achievements', `${Object.keys(game.achievements).length}/${ACHIEVEMENTS.length}`)),
      h('table', { class: 'results' },
        h('thead', null, h('tr', null, ...['Field', 'NPV', 'IRR', 'Recovery', 'Kicks', 'Incidents'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, game.results.map((r) => h('tr', null,
          h('td', null, String(r.fieldNo)), h('td', { class: 'num' }, fmt.money(r.npv)), h('td', { class: 'num' }, r.irr == null ? 'n/a' : fmt.pct(r.irr)),
          h('td', { class: 'num' }, fmt.pct(r.recovery)), h('td', { class: 'num' }, String(r.kicks)), h('td', { class: 'num' }, String(r.incidents)))))),
    ],
    actions: [btn('Start a new campaign', () => { startNewCampaign(); closeModal(); }, { cls: 'btn btn-primary' })],
  });
}

function startNewCampaign() {
  game = newGame(freshSeed(), { mode: game.mode, settings: game.settings, tipsSeen: game.tipsSeen, achievements: game.achievements, best: game.best });
  priceRng = createRng(`${game.seed}:price:1`);
  xray = false;
  applyCosmetics();
  saveGame();
  render(true);
}

function confirmNewCampaign() {
  showModal({
    key: 'confirm-new', title: 'Start a new campaign?',
    body: h('p', null, 'This ends your current campaign. Your best score, achievements and settings are kept. Items, budget and progress reset.'),
    actions: [btn('Cancel', closeModal, { cls: 'btn' }), btn('Start new campaign', () => { closeModal(); startNewCampaign(); }, { cls: 'btn btn-primary' })],
  });
}

function showAchievements() {
  showModal({
    key: 'achievements', cls: 'modal-wide', title: 'Achievements',
    body: h('ul', { class: 'ach-list' }, ACHIEVEMENTS.map((a) => h('li', { class: `ach${game.achievements[a.id] ? ' is-on' : ''}` },
      h('span', { class: 'ach-icon', 'aria-hidden': 'true' }), h('div', null, h('strong', null, a.label), h('span', null, a.desc)),
      h('span', { class: 'ach-state' }, game.achievements[a.id] ? 'Unlocked' : 'Locked')))),
    actions: [btn('Close', closeModal, { cls: 'btn btn-primary' })],
  });
}

// ------------------------------------------------------------------ crates & shop
function openShop(needed = 0) {
  const aaa = game.mode === 'aaa';
  const cards = BUNDLES.map((b) => {
    const total = game.dbx + b.dbx;
    return h('div', { class: 'bundle' },
      aaa && b.id === 'b4' ? h('span', { class: 'bundle-tag' }, 'Best value') : null,
      aaa && b.id === 'b2' ? h('span', { class: 'bundle-tag' }, 'Most popular') : null,
      h('span', { class: 'bundle-dbx' }, `${fmt.int(b.dbx)} Drillbux`),
      aaa ? null : h('span', { class: 'bundle-meta' }, `${fmt.usd((b.price / b.dbx) * CRATE_COST_DBX)} per crate · ${Math.floor(total / CRATE_COST_DBX)} crates · ${total % CRATE_COST_DBX} left over`),
      btn(fmt.usd(b.price), () => (aaa ? purchase(b) : confirmPurchase(b)), { cls: aaa ? 'btn btn-shop' : 'btn' }));
  });
  const body = [h('div', { class: 'bundles' }, cards)];
  if (!aaa && needed > 0) {
    const c = cheapestPurchase(needed);
    body.unshift(h('p', null, `You need ${needed} more Drillbux. The cheapest way costs ${fmt.usd(c.price)} and strands ${c.leftover} Drillbux — bundle sizes never divide evenly into crates.`));
  }
  body.push(h('p', { class: 'hint' }, 'Simulated store. No payment details are collected and no money changes hands.'));
  showModal({ key: 'shop', title: aaa ? 'Power up your rig!' : 'Buy Drillbux (simulated)', body, actions: [btn('Close', closeModal, { cls: 'btn' })] });
}

function confirmPurchase(b) {
  showModal({
    key: 'confirm-buy', title: 'Confirm simulated purchase',
    body: [h('p', null, `In a real game this would charge ${fmt.usd(b.price)}. Your simulated total would become ${fmt.usd(game.realSpent + b.price)}.`),
      h('p', null, `That's the net revenue from about ${fmt.int(b.price / Math.max(1, game.oilPrice * 0.875 - 14))} barrels of oil at today's price.`)],
    actions: [btn('Back', () => openShop(), { cls: 'btn' }), btn(`Buy for ${fmt.usd(b.price)} (simulated)`, () => purchase(b), { cls: 'btn btn-primary' })],
  });
}

function purchase(b) {
  buyBundle(game, b.id);
  sound.cash();
  saveGame();
  closeModal();
  toast(`+${fmt.int(b.dbx)} Drillbux`);
  update();
}

async function tryOpen(currency) {
  if (crateBusy || game.event) return;
  if (!canOpen(game, currency)) {
    if (currency === 'dbx') openShop(CRATE_COST_DBX - game.dbx);
    else toast(currency === 'budget' ? 'Not enough field budget.' : 'Not enough scrap.');
    return;
  }
  crateBusy = true;
  const res = openCrate(game, currency);
  saveGame();
  update();
  const fast = game.mode === 'regulator';
  sound.thud();
  await rig.playCrate(rarityColor[res.rarity], fast);
  if (game.mode === 'aaa') sound.fanfare();
  if (game.mode === 'aaa' && res.rarity !== 'legendary' && !reducedMotion) {
    showModal({ key: 'tease', title: '…', body: h('p', { class: 'reveal reveal-tease', css: { '--rar': rarityColor.legendary } }, res.teaser.name) });
    await new Promise((r) => setTimeout(r, 700));
  }
  showModal({
    key: 'reveal', cls: 'modal-reveal', title: rarityLabel[res.rarity],
    body: [
      h('p', { class: 'reveal', css: { '--rar': rarityColor[res.rarity] } }, res.item.name),
      h('p', null, res.item.blurb),
      h('p', { class: 'hint' }, effectText(res.item) + (res.duplicate ? ` — duplicate, converted to ${SCRAP_VALUE[res.rarity]} scrap` : '')),
      game.mode === 'aaa' && res.rarity !== 'legendary' ? h('p', { class: 'hint' }, 'So close! The next one could be legendary.') : null,
      game.mode === 'regulator' && res.rarity !== 'legendary' ? h('p', { class: 'hint' }, 'In AAA mode a legendary item flashes before this result. That "near miss" was never a possible outcome of this roll.') : null,
    ],
    actions: [
      btn('Done', () => { closeModal(); render(true); }, { cls: 'btn' }),
      btn('Equip', () => { equip(game, res.item.id); applyCosmetics(); saveGame(); closeModal(); render(true); }, { cls: 'btn btn-primary' }),
    ],
  });
  crateBusy = false;
}

// ------------------------------------------------------------------ coach, toasts, ticker
const coach = h('aside', { class: 'coach', role: 'note', 'aria-live': 'polite' });
const toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
const achEl = h('div', { class: 'ach-toast', role: 'status', 'aria-live': 'polite' });
document.body.append(coach, toastEl, achEl);
let toastTimer = 0, achTimer = 0, coachKey = null;

function toast(msg) {
  setText(toastEl, msg);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function showAchievementToast(id) {
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) return;
  achEl.replaceChildren(h('span', { class: 'ach-icon', 'aria-hidden': 'true' }), h('div', null, h('strong', null, game.mode === 'aaa' ? `ACHIEVEMENT UNLOCKED! ${a.label}` : `Achievement: ${a.label}`), h('span', null, a.desc)));
  achEl.classList.add('show');
  game.mode === 'aaa' ? sound.fanfare() : sound.good();
  clearTimeout(achTimer);
  achTimer = setTimeout(() => achEl.classList.remove('show'), 3800);
}

function currentTip() {
  if (!game.settings.tutorial || game.event || dialog.open) return null;
  const f = game.f;
  const tips = [
    [f.phase === 'drilling' && f.depth === 0, 'spud', 'Set mud weight and pump rate, then press Spud well. Drag the 3D view to look around.'],
    [f.phase === 'drilling' && f.depth > 300 && f.depth < 3000, 'hydraulics', 'Watch the two needles on the mud window: yellow is static mud weight, orange is ECD while pumping. Pump faster for better hole cleaning, but ECD rises.'],
    [f.phase === 'drilling' && f.depth >= 3800 && f.depth < 5000 && f.mudWeight < 11.6, 'overpressure', 'Overpressured shale starts at 5,000 ft (pore pressure ≈ 11.5 ppg). Raise mud weight above 11.6 ppg now, or take a kick and learn to kill it.'],
    [f.phase === 'drilling' && f.cuttings > 0.45, 'cleaning', 'Cuttings are building up. Increase pump rate so annular velocity beats the requirement, or the pipe will pack off.'],
    [f.phase === 'completion', 'completion', 'Completion items (acid, frac) lower skin and raise the initial rate. Equip one from the store before completing the well.'],
    [f.phase === 'production' && (f.well?.t ?? 0) < 400, 'choke', 'Choose a choke: bigger means more oil now and a faster decline. When natural flow fades, install artificial lift.'],
    [f.phase === 'abandon', 'abandon', 'Plug and abandon to close the field and see its economics report: NPV, IRR, payback and a cash flow diagram.'],
  ];
  const t = tips.find(([cond, key]) => cond && !game.tipsSeen[key]);
  return t ? { key: t[1], text: t[2] } : null;
}

function updateCoach() {
  const tip = currentTip();
  if (!tip) { coach.classList.remove('show'); coachKey = null; return; }
  if (tip.key === coachKey) return;
  coachKey = tip.key;
  coach.replaceChildren(
    h('span', { class: 'coach-tag' }, 'Tip'),
    h('p', null, tip.text),
    h('div', { class: 'coach-actions' },
      btn('Got it', () => { game.tipsSeen[tip.key] = true; saveGame(); coachKey = null; updateCoach(); }, { cls: 'btn btn-small btn-primary' }),
      btn('Turn off tips', () => { game.settings.tutorial = false; saveGame(); coachKey = null; render(true); }, { cls: 'btn btn-small' })),
  );
  coach.classList.add('show');
}

function ticker() {
  return h('footer', { class: 'ticker' },
    readout('Brent (sim)', 'tkPrice'), readout('Project NPV @10%', 'tkNpv'), readout('Day', 'tkDays'),
    readout('Field', 'tkField'), readout('Simulated money spent', 'tkSpent'));
}

function tabs() {
  return h('nav', { class: 'tabs', 'aria-label': 'Panels' },
    [['console', 'Console'], ['store', 'Store']].map(([id, label]) =>
      h('button', { type: 'button', class: 'tab', 'aria-pressed': String(activeTab === id), on: { click: () => { activeTab = id; render(true); } } }, label)));
}

// ------------------------------------------------------------------ render & update
function computeStructureKey() {
  const f = game.f;
  return [game.mode, game.fieldNo, f.phase, f.shoe, f.nozzle, f.well?.choke, f.well?.lift, f.well?.waterHandling, game.campaignOver,
    JSON.stringify(game.inventory), JSON.stringify(game.equipped), Object.keys(game.achievements).length, game.settings.sound, game.settings.tutorial, activeTab].join('|');
}

function render(force = false) {
  const key = computeStructureKey();
  if (!force && key === structureKey) return;
  structureKey = key;
  const fk = document.activeElement?.dataset?.fk;
  document.body.classList.toggle('mode-aaa', game.mode === 'aaa');
  document.body.classList.toggle('mode-regulator', game.mode === 'regulator');
  document.body.dataset.tab = activeTab;
  for (const k of Object.keys(refs)) delete refs[k];
  root.replaceChildren(topbar(), consolePanel(), storePanel(), tabs(), ticker());
  refs.drillBtn = root.querySelector('[data-fk="drill"]');
  if (fk) root.querySelector(`[data-fk="${CSS.escape(fk)}"]`)?.focus();
  applyCosmetics();
  update();
}

function update() {
  const g = game, f = g.f;
  setText(refs.fieldPill, `Field ${g.fieldNo} of ${FIELDS_PER_CAMPAIGN}`);
  setText(refs.budget, fmt.money(g.budget));
  setText(refs.dbx, fmt.int(g.dbx));
  setText(refs.scrap, fmt.int(g.scrap));
  setText(refs.tkPrice, `${fmt.usd(g.oilPrice)}/bbl`);
  setText(refs.tkNpv, fmt.money(g.project.npv));
  setText(refs.tkDays, fmt.int(g.project.days));
  setText(refs.tkField, `${g.fieldNo}/${FIELDS_PER_CAMPAIGN}`);
  setText(refs.tkSpent, fmt.usd(g.realSpent));
  if (refs.timer) setText(refs.timer, `${String(Math.floor(offerSeconds / 60)).padStart(2, '0')}:${String(offerSeconds % 60).padStart(2, '0')}`);
  root.querySelector('[data-fk="open-budget"]')?.toggleAttribute('disabled', !canOpen(g, 'budget'));
  root.querySelector('[data-fk="open-scrap"]')?.toggleAttribute('disabled', !canOpen(g, 'scrap'));

  if (f.phase === 'drilling') {
    const hy = drillingHydraulics(g);
    const fm = formationAt(f.depth);
    const rop = currentRop(g);
    const req = requiredAnnularVelocity(rop);
    setText(refs.depth, fmt.int(f.depth));
    setText(refs.formation, fm.name);
    if (refs.depthFill) refs.depthFill.style.width = `${(f.depth / TARGET_DEPTH) * 100}%`;
    refs.depthBar?.setAttribute('aria-valuenow', String(Math.round(f.depth)));
    setText(refs.rop, f.drilling ? `${rop.toFixed(0)} ft/hr` : `${rop.toFixed(0)} ft/hr (idle)`);
    setText(refs.bitName, g.equipped.bit ? itemById(g.equipped.bit).name : 'Rental mill-tooth');
    setText(refs.shoe, f.shoe ? `${fmt.int(f.shoe)} ft` : '—');
    setText(refs.ecd, `${hy.ecd.toFixed(2)} ppg`);
    setText(refs.mwVal, `${f.mudWeight.toFixed(1)} ppg`);
    setText(refs.pumpVal, `${f.pumpRate} gpm`);
    if (refs.mwInput && document.activeElement !== refs.mwInput) refs.mwInput.value = String(f.mudWeight);
    if (refs.pumpInput && document.activeElement !== refs.pumpInput) refs.pumpInput.value = String(f.pumpRate);
    const lo = gradientToPpg(fm.poreGrad), hi = gradientToPpg(weakestFracGrad(f.shoe, Math.max(1, f.depth)));
    const pos = (v) => `${Math.max(0, Math.min(100, ((v - 8.6) / (17 - 8.6)) * 100))}%`;
    if (refs.windowSafe) { refs.windowSafe.style.left = pos(lo); refs.windowSafe.style.width = `calc(${pos(hi)} - ${pos(lo)})`; }
    if (refs.needleMw) refs.needleMw.style.left = pos(f.mudWeight);
    if (refs.needleEcd) refs.needleEcd.style.left = pos(hy.ecd);
    const d = Math.max(1, f.depth);
    setText(refs.windowText, `Window here ${lo.toFixed(1)}–${hi.toFixed(1)} ppg · hydrostatic ${fmt.int(hydrostatic(f.mudWeight, d))} psi vs pore ${fmt.int(fm.poreGrad * d)} psi`);
    refs.sppDial?.set(hy.spp);
    setText(refs.avText, `${hy.av.toFixed(0)} ft/min (need ${req.toFixed(0)})`);
    if (refs.avFill) { refs.avFill.style.width = `${Math.min(100, (hy.av / 400) * 100)}%`; refs.avFill.classList.toggle('is-bad', hy.av < req); }
    if (refs.avMark) refs.avMark.style.left = `${Math.min(100, (req / 400) * 100)}%`;
    setText(refs.cutText, fmt.pct(f.cuttings, 0));
    if (refs.cutFill) { refs.cutFill.style.width = `${f.cuttings * 100}%`; refs.cutFill.classList.toggle('is-bad', f.cuttings > 0.6); }
    if (refs.cutMark) refs.cutMark.style.display = 'none';
    setText(refs.pumpAlarm, f.pumpAlarm ? `Pump pressure over ${fmt.int(PUMP_LIMIT_PSI)} psi. Reduce flow or fit larger nozzles.` : '');
    setText(refs.drillBtn, f.drilling ? 'Pause drilling' : f.depth > 0 ? 'Resume drilling' : 'Spud well');
  } else if (f.phase === 'production' && f.well) {
    const w = f.well;
    const eur = currentEur(g);
    setText(refs.rate, fmt.int(w.rate));
    setText(refs.water, `${fmt.int(w.waterRate)} bbl/d water`);
    setText(refs.wcText, fmt.pct(w.wc, 0));
    if (refs.wcFill) refs.wcFill.style.width = `${w.wc * 100}%`;
    setText(refs.npText, `${fmt.bbl(w.np)} / ${fmt.bbl(eur)}`);
    if (refs.npFill) refs.npFill.style.width = `${Math.min(100, (w.np / Math.max(1, eur)) * 100)}%`;
    if (refs.wcMark) refs.wcMark.style.display = 'none';
    if (refs.npMark) refs.npMark.style.display = 'none';
    setText(refs.rf, fmt.pct(w.np / w.ooip));
    setText(refs.skin, w.skin.toFixed(1));
    setText(refs.drive, w.lift === 'natural' ? fmt.pct(naturalFlowFactor(w.np / Math.max(1, eur)), 0) : LIFTS[w.lift].label);
    setText(refs.fieldCash, fmt.money(f.ledger.reduce((s, y) => s + y.revenue - y.capex - y.opex - y.crates, 0)));
  }
}

// ------------------------------------------------------------------ graphics quality
function setGraphics(level) {
  game.settings.graphics = level;
  document.body.classList.toggle('lite', level === 'low');
}
setGraphics(game.settings.graphics);
// Auto-detect: if the first seconds run slowly, drop to low graphics once.
const perf = { frames: 0, start: 0, done: game.settings.graphics !== 'auto' };
function perfSample(now) {
  if (perf.done) return;
  if (!perf.start) { perf.start = now + 1500; return; } // skip start-up frames
  if (now < perf.start) return;
  perf.frames++;
  if (now - perf.start > 3000) {
    perf.done = true;
    const fps = perf.frames / ((now - perf.start) / 1000);
    setGraphics(fps < 24 ? 'low' : 'high');
    if (fps < 24) toast('Switched to low graphics for smoother play. Change it in the top bar.');
    saveGame();
    render(true);
  }
}

// ------------------------------------------------------------------ main loop
let last = performance.now(), uiAcc = 0, saveAcc = 0, secAcc = 0, todAcc = 99;
let wasDrilling = false;
function loop(now) {
  requestAnimationFrame(loop);
  // Real elapsed time (capped at 0.5 s so a background tab doesn't jump ahead).
  // Simulation steps are sub-divided below, so slow frames don't slow the game clock.
  const dt = Math.max(0, Math.min(0.5, (now - last) / 1000));
  last = now;
  const g = game;
  perfSample(now);

  if (dialog.open) {
    modalTick?.(dt);
  } else if (g.event) {
    renderEvent();
  } else if (!g.campaignOver) {
    const before = g.f.phase;
    if (g.f.phase === 'drilling') tickDrilling(g, dt * HOURS_PER_SECOND);
    else if (g.f.phase === 'production') tickProduction(g, dt * DAYS_PER_SECOND, priceRng);
    if (g.event) renderEvent();
    if (g.f.phase !== before) {
      saveGame();
      render(true);
      if (g.f.phase === 'completion') { toast('Target depth reached.'); sound.good(); }
      if (g.f.phase === 'abandon') toast('The well has reached its economic limit.');
    }
  }

  // notices & achievements
  while (g.notices.length) toast(g.notices.shift());
  if (g.unlocked.length) showAchievementToast(g.unlocked.shift());

  // scene
  const drilling = g.f.phase === 'drilling' && g.f.drilling && !g.event;
  if (drilling !== wasDrilling) { sound.drilling(drilling); wasDrilling = drilling; }
  rig.setDepth(g.f.phase === 'drilling' || g.f.phase === 'completion' ? g.f.depth : TARGET_DEPTH);
  rig.setCasing(g.f.phase === 'drilling' ? g.f.shoe : 5000);
  rig.setState({ ...sceneState(), ...cosmetics });
  rig.frame(dt, { drilling, busy: crateBusy });
  todAcc += dt;
  if (todAcc > 1.5) { todAcc = 0; rig.setTimeOfDay(((now / 1000) / DAY_CYCLE_SECONDS + 0.38) % 1); }
  rig.setStorm(now < stormUntil);

  secAcc += dt;
  if (secAcc >= 1) {
    secAcc -= 1;
    offerSeconds--;
    if (offerSeconds < 0) { offerSeconds = 299; g.timerResets++; }
  }
  uiAcc += dt;
  if (uiAcc > 0.1) { uiAcc = 0; render(); update(); updateCoach(); }
  saveAcc += dt;
  if (saveAcc > 5) { saveAcc = 0; saveGame(); }
}

window.addEventListener('pointerdown', () => sound.unlock(), { once: true });
window.addEventListener('pagehide', saveGame);
render(true);
if (game.campaignOver) showCampaignEnd();
else if (game.f.phase === 'report') showReport();
requestAnimationFrame(loop);
