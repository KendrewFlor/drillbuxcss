// Engineering economics — pure functions.

/** NPV of end-of-period cash flows; cf[0] is t = 0. rate per period. */
export function npv(rate, cashflows) {
  return cashflows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + rate, t), 0);
}

export function dailyRate(annual) {
  return Math.pow(1 + annual, 1 / 365) - 1;
}

/**
 * IRR: scan for the first sign change of NPV(r) above −99%, then bisect.
 * Returns null when there is none (e.g. every cash flow has the same sign).
 */
export function irr(cashflows, lo = -0.99, hi = 1000) {
  const f = (r) => npv(r, cashflows);
  // Scan from high rates downward: for a conventional project (outflow, inflows, small
  // P&A outflow at the end) the first root found is the economically meaningful one.
  const grid = [];
  for (let r = lo; r < hi; r = r < 1 ? r + 0.01 : r * 1.05) grid.push(r);
  grid.push(hi);
  grid.reverse();
  let a = null, b = null;
  for (let i = 1; i < grid.length; i++) {
    const fa = f(grid[i - 1]), fb = f(grid[i]);
    if (Number.isFinite(fa) && Number.isFinite(fb) && fa * fb <= 0) { a = grid[i]; b = grid[i - 1]; break; }
  }
  if (a === null) return null;
  let fa = f(a);
  for (let i = 0; i < 100; i++) {
    const mid = (a + b) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < 1e-7 || b - a < 1e-10) return mid;
    if (fa * fm <= 0) b = mid; else { a = mid; fa = fm; }
  }
  return (a + b) / 2;
}

/** Simple payback period in periods (fractional), or null if never repaid. */
export function paybackPeriod(cashflows) {
  let cum = 0;
  for (let t = 0; t < cashflows.length; t++) {
    const prev = cum;
    cum += cashflows[t];
    if (t > 0 && prev < 0 && cum >= 0) return t - 1 + -prev / cashflows[t];
    if (t === 0 && cum >= 0) return 0;
  }
  return null;
}

/** Profitability index = PV of inflows / PV of outflows. */
export function profitabilityIndex(rate, cashflows) {
  let pin = 0, pout = 0;
  cashflows.forEach((cf, t) => {
    const pv = cf / Math.pow(1 + rate, t);
    if (pv >= 0) pin += pv; else pout -= pv;
  });
  return pout === 0 ? null : pin / pout;
}

/**
 * Ledger entry helper. The ledger is an array of years; each year tracks
 * capex, opex, revenue and crate spend separately so the report can show
 * "with crates" vs "without crates".
 */
export function ledgerAdd(ledger, year, kind, amount) {
  while (ledger.length <= year) ledger.push({ capex: 0, opex: 0, revenue: 0, crates: 0 });
  ledger[year][kind] += amount;
}

export function ledgerNet(ledger, { includeCrates = true } = {}) {
  return ledger.map((y) => y.revenue - y.capex - y.opex - (includeCrates ? y.crates : 0));
}

export function fieldEconomics(ledger, annualRate = 0.1) {
  const withCrates = ledgerNet(ledger, { includeCrates: true });
  const without = ledgerNet(ledger, { includeCrates: false });
  return {
    years: ledger.length,
    cashflows: withCrates,
    npv: npv(annualRate, withCrates),
    npvNoCrates: npv(annualRate, without),
    irr: irr(withCrates),
    payback: paybackPeriod(withCrates),
    pi: profitabilityIndex(annualRate, withCrates),
    crateSpend: ledger.reduce((s, y) => s + y.crates, 0),
    capex: ledger.reduce((s, y) => s + y.capex, 0),
    revenue: ledger.reduce((s, y) => s + y.revenue, 0),
    opex: ledger.reduce((s, y) => s + y.opex, 0),
  };
}
