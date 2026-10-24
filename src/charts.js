// SVG charts and CSS dial gauges, built with the injection-safe helpers.
import { h, s, fmt } from './dom.js';

/**
 * Cash flow diagram: one arrow per project year, length ∝ magnitude.
 * Down (red) for net outflow, up (green) for net inflow. Capex at t = 0 is drawn first.
 */
export function cashFlowDiagram(cashflows, { title = 'Cash flow diagram (net, per year)' } = {}) {
  const W = 620, H = 270, pad = { l: 56, r: 16, t: 24, b: 44 };
  const n = Math.max(1, cashflows.length);
  const max = Math.max(1, ...cashflows.map((v) => Math.abs(v)));
  const mid = pad.t + (H - pad.t - pad.b) / 2;
  const half = (H - pad.t - pad.b) / 2 - 6;
  const step = (W - pad.l - pad.r) / n;
  const kids = [
    s('title', {}, title),
    s('line', { x1: pad.l - 8, y1: mid, x2: W - pad.r, y2: mid, class: 'cfd-axis' }),
    s('text', { x: W - pad.r, y: H - 8, class: 'cfd-label', 'text-anchor': 'end' }, 'End of year →'),
    s('text', { x: 6, y: pad.t, class: 'cfd-label' }, fmt.money(max)),
    s('text', { x: 6, y: H - pad.b + 4, class: 'cfd-label' }, `−${fmt.money(max)}`),
  ];
  cashflows.forEach((v, i) => {
    const x = pad.l + step * (i + 0.5);
    const len = Math.max(4, (Math.abs(v) / max) * half);
    const up = v >= 0;
    const y2 = up ? mid - len : mid + len;
    const head = up ? `${x - 6},${y2 + 9} ${x + 6},${y2 + 9} ${x},${y2}` : `${x - 6},${y2 - 9} ${x + 6},${y2 - 9} ${x},${y2}`;
    kids.push(
      s('line', { x1: x, y1: mid, x2: x, y2: up ? y2 + 8 : y2 - 8, class: up ? 'cfd-in' : 'cfd-out' }),
      s('polygon', { points: head, class: up ? 'cfd-in-head' : 'cfd-out-head' }),
      s('text', { x, y: mid + (up ? 16 : -8), class: 'cfd-year', 'text-anchor': 'middle' }, String(i)),
      s('text', { x, y: up ? y2 - 6 : y2 + 16, class: 'cfd-value', 'text-anchor': 'middle' }, fmt.money(v)),
    );
  });
  return s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'cfd', role: 'img', 'aria-label': title }, ...kids);
}

/** Live pressure-schedule chart for the choke panel. Returns { el, update(op) }. */
export function scheduleChart(op) {
  const W = 520, H = 200, pad = { l: 46, r: 10, t: 12, b: 26 };
  const maxP = Math.max(op.sheet.icp, op.entered.icp, Number.isFinite(op.sheet.maasp) ? op.sheet.maasp : 0, op.sheet.sicp * 1.6) * 1.15;
  const x = (strokes) => pad.l + (strokes / op.total) * (W - pad.l - pad.r);
  const y = (p) => H - pad.b - (Math.max(0, p) / maxP) * (H - pad.t - pad.b);
  const pts = [];
  for (let i = 0; i <= 120; i++) {
    const st = (i / 120) * op.total;
    pts.push(`${x(st).toFixed(1)},${y(targetAt(op, st)).toFixed(1)}`);
  }
  const target = s('polyline', { points: pts.join(' '), class: 'sch-target' });
  const dpp = s('polyline', { points: '', class: 'sch-dpp' });
  const cp = s('polyline', { points: '', class: 'sch-cp' });
  const cursor = s('line', { x1: pad.l, x2: pad.l, y1: pad.t, y2: H - pad.b, class: 'sch-cursor' });
  const maaspY = Number.isFinite(op.sheet.maasp) ? y(op.sheet.maasp) : null;
  const phaseLines = [];
  let acc = 0;
  op.phases.slice(0, -1).forEach((p) => { acc += p.strokes; phaseLines.push(s('line', { x1: x(acc), x2: x(acc), y1: pad.t, y2: H - pad.b, class: 'sch-phase' })); });
  const el = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sch', role: 'img', 'aria-label': 'Drill pipe pressure schedule' },
    s('line', { x1: pad.l, y1: H - pad.b, x2: W - pad.r, y2: H - pad.b, class: 'sch-axis' }),
    s('line', { x1: pad.l, y1: pad.t, x2: pad.l, y2: H - pad.b, class: 'sch-axis' }),
    s('text', { x: pad.l - 6, y: y(maxP * 0.85) + 4, class: 'sch-label', 'text-anchor': 'end' }, fmt.int(maxP * 0.85)),
    s('text', { x: pad.l - 6, y: H - pad.b, class: 'sch-label', 'text-anchor': 'end' }, '0'),
    s('text', { x: W - pad.r, y: H - 6, class: 'sch-label', 'text-anchor': 'end' }, `${fmt.int(op.total)} strokes`),
    maaspY != null ? s('line', { x1: pad.l, x2: W - pad.r, y1: maaspY, y2: maaspY, class: 'sch-maasp' }) : null,
    maaspY != null ? s('text', { x: W - pad.r - 4, y: maaspY - 4, class: 'sch-label sch-maasp-label', 'text-anchor': 'end' }, 'MAASP') : null,
    ...phaseLines,
    target, cp, dpp, cursor,
  );
  return {
    el,
    update(o) {
      const tr = o.trace;
      dpp.setAttribute('points', tr.map((p) => `${x(p.s).toFixed(1)},${y(p.dpp).toFixed(1)}`).join(' '));
      cp.setAttribute('points', tr.map((p) => `${x(p.s).toFixed(1)},${y(p.cp).toFixed(1)}`).join(' '));
      const cx = x(o.strokes).toFixed(1);
      cursor.setAttribute('x1', cx);
      cursor.setAttribute('x2', cx);
    },
  };
}

function targetAt(op, st) {
  let acc = 0;
  for (const p of op.phases) {
    if (st <= acc + p.strokes || p === op.phases[op.phases.length - 1]) {
      const ps = st - acc;
      if (!p.killMud) return op.entered.icp;
      return ps < op.sheet.toBit ? op.entered.icp + (op.entered.fcp - op.entered.icp) * (ps / op.sheet.toBit) : op.entered.fcp;
    }
    acc += p.strokes;
  }
  return op.entered.fcp;
}

/** Analog dial gauge drawn with CSS conic gradients. Returns { el, set(value, target) }. */
export function dial({ label, unit, max, red = null }) {
  let needle, targetNeedle, value;
  const redStart = red == null ? 1 : red / max;
  const el = h('div', { class: 'dial', css: { '--red-start': `${(redStart * 270).toFixed(1)}deg` } },
    h('div', { class: 'dial-face' },
      h('div', { class: 'dial-target', ref: (e) => { targetNeedle = e; } }),
      h('div', { class: 'dial-needle', ref: (e) => { needle = e; } }),
      h('div', { class: 'dial-hub' })),
    h('div', { class: 'dial-readout' }, h('span', { class: 'dial-value', ref: (e) => { value = e; } }, '0'), h('span', { class: 'dial-unit' }, unit)),
    h('div', { class: 'dial-label' }, label),
  );
  const angle = (v) => -135 + Math.max(0, Math.min(1, v / max)) * 270;
  return {
    el,
    set(v, target = null) {
      needle.style.transform = `rotate(${angle(v).toFixed(1)}deg)`;
      value.textContent = fmt.int(v);
      if (target == null) targetNeedle.style.display = 'none';
      else { targetNeedle.style.display = ''; targetNeedle.style.transform = `rotate(${angle(target).toFixed(1)}deg)`; }
      el.classList.toggle('dial-alarm', red != null && v >= red);
    },
  };
}
