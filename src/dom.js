// Tiny, injection-safe DOM builder. Text is always inserted as text nodes;
// there is deliberately no way to pass raw HTML through this helper.

const BLOCKED_ATTRS = /^(on|style$|srcdoc$|formaction$)/i;

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'on') for (const [evt, fn] of Object.entries(value)) el.addEventListener(evt, fn);
    else if (key === 'ref') value(el);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'css') for (const [p, v] of Object.entries(value)) el.style.setProperty(p, v);
    else if (BLOCKED_ATTRS.test(key)) throw new Error(`Attribute "${key}" is not allowed in h(); use the "on" or "css" props.`);
    else if (key === 'href' && !/^(#|https:\/\/|\.\/)/.test(String(value))) throw new Error('Only #, ./ and https:// links are allowed.');
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

export const fmt = {
  money: (v) => {
    const a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}k`;
    return `${s}$${a.toFixed(2)}`;
  },
  usd: (v) => `$${v.toFixed(2)}`,
  int: (v) => Math.round(v).toLocaleString('en-US'),
  bbl: (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)} MMbbl` : v >= 1e3 ? `${(v / 1e3).toFixed(1)} Mbbl` : `${Math.round(v)} bbl`),
  pct: (v, d = 1) => `${(v * 100).toFixed(d)}%`,
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_ATTR = /^[a-z][a-z0-9-]*$/i;

/** SVG element builder — same safety rules as h(): no event or style attributes, text as text nodes. */
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (!SVG_ATTR.test(key) || BLOCKED_ATTRS.test(key) || /^(href|xlink:href)$/i.test(key)) throw new Error(`SVG attribute "${key}" is not allowed.`);
    el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}
