// The "AAA monetization" layer — deliberately transparent.
// All money here is fictional. Nothing in this repository can charge anyone.
// Pure functions + plain data; covered by tests/economy.test.mjs.

export const RARITIES = [
  { id: 'common', label: 'Common', odds: 0.792, color: '#9aa4ad' },
  { id: 'rare', label: 'Rare', odds: 0.15, color: '#3fa7ff' },
  { id: 'epic', label: 'Epic', odds: 0.05, color: '#b06cff' },
  { id: 'legendary', label: 'Legendary', odds: 0.008, color: '#ffb000' },
];

export const PITY = { softStart: 74, softStep: 0.06, hard: 90 }; // legendary pity, counted in pulls

// Every item has a real petroleum-engineering effect (or, for cosmetics, pointedly none).
export const ITEMS = [
  // Drill bits — rate of penetration multiplier
  { id: 'steel-tricone', name: 'Steel-Tooth Tricone Bit', rarity: 'common', slot: 'bit', effect: { rop: 1.15 }, blurb: 'Milled teeth for soft formations.' },
  { id: 'tci-tricone', name: 'TCI Tricone Bit', rarity: 'rare', slot: 'bit', effect: { rop: 1.4 }, blurb: 'Tungsten-carbide inserts chew medium-hard rock.' },
  { id: 'pdc', name: 'PDC Cutter Bit', rarity: 'epic', slot: 'bit', effect: { rop: 1.85 }, blurb: 'Polycrystalline diamond compact shears instead of crushing.' },
  { id: 'diamond-turbo', name: 'Diamond-Impregnated Turbodrill Bit', rarity: 'legendary', slot: 'bit', effect: { rop: 2.6 }, blurb: 'Turbine-driven, grinds through anything.' },
  // Completion — skin factor change
  { id: 'acid-wash', name: 'HCl Acid Wash', rarity: 'common', slot: 'completion', effect: { skin: -1 }, blurb: 'Dissolves near-wellbore damage.' },
  { id: 'frac-stage', name: 'Hydraulic Frac Stage', rarity: 'rare', slot: 'completion', effect: { skin: -3 }, blurb: 'Proppant-packed fracture → negative skin.' },
  { id: 'multistage-frac', name: 'Multi-Stage Plug & Perf', rarity: 'epic', slot: 'completion', effect: { skin: -4.5 }, blurb: 'Several fractures along the pay zone.' },
  // EOR — recovery factor bonus
  { id: 'gas-lift', name: 'Gas Lift Mandrels', rarity: 'common', slot: 'eor', effect: { recovery: 0.02, pwfDrop: 200 }, blurb: 'Lightens the fluid column, lowers Pwf.' },
  { id: 'waterflood', name: 'Five-Spot Waterflood', rarity: 'rare', slot: 'eor', effect: { recovery: 0.1 }, blurb: 'Secondary recovery by pressure maintenance.' },
  { id: 'polymer', name: 'Polymer Flood', rarity: 'epic', slot: 'eor', effect: { recovery: 0.14 }, blurb: 'Better mobility ratio, better sweep.' },
  { id: 'co2-miscible', name: 'CO₂ Miscible Injector', rarity: 'legendary', slot: 'eor', effect: { recovery: 0.2 }, blurb: 'Tertiary recovery — and some CO₂ stays underground.' },
  // Cosmetics — no gameplay effect, which is the point
  { id: 'gold-hardhat', name: 'Gold-Plated Hard Hat', rarity: 'common', slot: 'cosmetic', effect: {}, blurb: 'Does nothing. Still not PPE compliant.' },
  { id: 'neon-derrick', name: 'Neon Derrick Skin', rarity: 'rare', slot: 'cosmetic', effect: { skin3d: 0xff2bd6 }, blurb: 'Your derrick, but it glows.' },
  { id: 'chrome-derrick', name: 'Chrome Derrick Skin', rarity: 'epic', slot: 'cosmetic', effect: { skin3d: 0xd8e3ea }, blurb: 'Blinding at noon.' },
  { id: 'aurora-flare', name: 'Aurora Flare Effect', rarity: 'legendary', slot: 'cosmetic', effect: { flare: 0x37ffb0 }, blurb: 'Green flare. Zero barrels.' },
];

// Premium currency bundles. Note the prices never divide evenly into crates.
export const BUNDLES = [
  { id: 'b1', price: 4.99, dbx: 450 },
  { id: 'b2', price: 9.99, dbx: 1000 },
  { id: 'b3', price: 19.99, dbx: 2100 },
  { id: 'b4', price: 49.99, dbx: 5500 },
];

export const CRATE_COST_DBX = 300;
export const CRATE_COST_PETRODOLLARS = 400_000; // the "grind" price
export const SCRAP_VALUE = { common: 5, rare: 25, epic: 100, legendary: 400 };

/** Legendary probability for the Nth pull since the last legendary (1-based). */
export function legendaryChance(pullsSinceLegendary) {
  const n = pullsSinceLegendary;
  if (n >= PITY.hard) return 1;
  const base = RARITIES.find((r) => r.id === 'legendary').odds;
  if (n < PITY.softStart) return base;
  return Math.min(1, base + PITY.softStep * (n - PITY.softStart + 1));
}

/** Exact expected number of pulls until the first legendary, given pity. */
export function expectedPullsToLegendary() {
  let survive = 1;
  let expected = 0;
  for (let n = 1; n <= PITY.hard; n++) {
    const p = legendaryChance(n);
    expected += n * survive * p;
    survive *= 1 - p;
  }
  return expected;
}

/** Effective long-run legendary rate including pity (1 / expected pulls). */
export function effectiveLegendaryRate() {
  return 1 / expectedPullsToLegendary();
}

/**
 * Roll one crate. Pure: returns the item and the new pity counter.
 * rng: { next(): number in [0,1) }
 */
export function rollCrate(rng, pullsSinceLegendary) {
  const n = pullsSinceLegendary + 1;
  const pLeg = legendaryChance(n);
  let rarity;
  const u = rng.next();
  if (u < pLeg) {
    rarity = 'legendary';
  } else {
    // Renormalise the remaining odds across non-legendary tiers.
    const rest = RARITIES.filter((r) => r.id !== 'legendary');
    const total = rest.reduce((s, r) => s + r.odds, 0);
    let v = rng.next() * total;
    rarity = rest[rest.length - 1].id;
    for (const r of rest) {
      if (v < r.odds) { rarity = r.id; break; }
      v -= r.odds;
    }
  }
  const pool = ITEMS.filter((i) => i.rarity === rarity);
  const item = pool[Math.floor(rng.next() * pool.length)];
  // "Near miss" theatre data: what the reel shows just before stopping (AAA mode only)
  const teaser = ITEMS.filter((i) => i.rarity === 'legendary')[Math.floor(rng.next() * 2)];
  return { item, rarity, pity: rarity === 'legendary' ? 0 : n, teaser };
}

/** Cheapest real-money cost to obtain at least `dbxNeeded`, and the leftover DBX. */
export function cheapestPurchase(dbxNeeded) {
  // Exhaustive search over bundle counts — tiny for realistic amounts.
  if (dbxNeeded <= 0) return { price: 0, dbx: 0, leftover: 0, counts: {} };
  let best = null;
  const rec = (i, counts, dbx, price) => {
    if (i === BUNDLES.length) {
      if (dbx < dbxNeeded) return;
      const better = !best || price < best.price - 1e-9 || (Math.abs(price - best.price) < 1e-9 && dbx < best.dbx);
      if (better) best = { price: +price.toFixed(2), dbx, leftover: dbx - dbxNeeded, counts: { ...counts } };
      return;
    }
    const b = BUNDLES[i];
    const max = Math.ceil(Math.max(0, dbxNeeded - dbx) / b.dbx);
    for (let c = 0; c <= max; c++) rec(i + 1, { ...counts, [b.id]: c }, dbx + b.dbx * c, price + b.price * c);
  };
  rec(0, {}, 0, 0);
  return best;
}

/** Real-money price of one crate at the best (largest) bundle rate. */
export function bestDollarsPerCrate() {
  const best = Math.min(...BUNDLES.map((b) => b.price / b.dbx));
  return best * CRATE_COST_DBX;
}

/** Expected real-money cost to get a legendary from zero pity. */
export function expectedDollarsPerLegendary() {
  return expectedPullsToLegendary() * bestDollarsPerCrate();
}

export function itemById(id) {
  return ITEMS.find((i) => i.id === id);
}
