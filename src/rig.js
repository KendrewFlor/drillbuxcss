// Pure-CSS 3D offshore jack-up rig. Every shape is a <div> placed with CSS 3D
// transforms; there is no canvas, WebGL or image file anywhere.
import { h } from './dom.js';
import { FORMATIONS, TARGET_DEPTH } from './reservoir.js';

// World units are px. Sea level is y = 0; up is negative y (CSS convention).
const SEABED = 260;
const STRATA_PX = 560; // 8,000 ft of rock
const DECK = -178; // top of hull
const FLOOR = DECK - 80; // drill floor (top of substructure)
const DERRICK = { x: -40, z: -30, base: 56, top: 15, height: 300 };
const LEGS = [[-160, -120], [160, -120], [0, 150]];

export const ftToY = (ft) => SEABED + (ft / TARGET_DEPTH) * STRATA_PX;

const px = (n) => `${n}px`;
const t3 = (x, y, z) => `translate3d(${x}px, ${y}px, ${z}px)`;

/** A positioned group in 3D space. */
function group(cls, transform, ...kids) {
  return h('div', { class: `g3 ${cls}`, css: { transform } }, ...kids);
}

/** A rectangular plane centred on its group origin. */
function plane(cls, w, hgt, transform, ...kids) {
  return h('div', { class: `face ${cls}`, css: { width: px(w), height: px(hgt), left: px(-w / 2), top: px(-hgt / 2), transform } }, ...kids);
}

/** A six-sided box. `mat` sets the material class; `faces` can override per face. */
function box(mat, w, hgt, d, transform, { faces = {}, extra = '' } = {}) {
  const f = (side, fw, fh, tf) => plane(`${mat} side-${side} ${faces[side] ?? ''}`, fw, fh, tf);
  return group(`box ${extra}`, transform,
    f('front', w, hgt, `translateZ(${d / 2}px)`),
    f('back', w, hgt, `rotateY(180deg) translateZ(${d / 2}px)`),
    f('right', d, hgt, `rotateY(90deg) translateZ(${w / 2}px)`),
    f('left', d, hgt, `rotateY(-90deg) translateZ(${w / 2}px)`),
    f('top', w, d, `rotateX(90deg) translateZ(${hgt / 2}px)`),
    f('bottom', w, d, `rotateX(-90deg) translateZ(${hgt / 2}px)`),
  );
}

/** Square lattice tower (4 open faces) — legs, crane booms. */
function latticeColumn(cls, size, hgt, transform) {
  const faces = [0, 90, 180, 270].map((r) => plane(`lattice ${cls}`, size, hgt, `rotateY(${r}deg) translateZ(${size / 2}px)`));
  return group('lattice-col', transform, ...faces);
}

/** Tapered derrick: four trapezoid faces tilted inward. */
function derrick() {
  const { base: B, top: T, height: H } = DERRICK;
  const slant = Math.hypot(H, B - T);
  const tilt = (Math.atan2(B - T, H) * 180) / Math.PI;
  const inset = ((B - T) / (2 * B)) * 100;
  const clip = `polygon(0 100%, 100% 100%, ${100 - inset}% 0, ${inset}% 0)`;
  const sides = [
    { pos: t3(0, 0, B), r: 0 }, { pos: t3(B, 0, 0), r: 90 },
    { pos: t3(0, 0, -B), r: 180 }, { pos: t3(-B, 0, 0), r: -90 },
  ];
  const faces = sides.map(({ pos, r }) => group('derrick-side', pos,
    h('div', { class: 'face derrick-face', css: { width: px(2 * B), height: px(slant), left: px(-B), top: px(-slant), 'clip-path': clip, transform: `rotateY(${r}deg) rotateX(${tilt}deg)` } })));
  return group('derrick', t3(DERRICK.x, FLOOR, DERRICK.z),
    ...faces,
    box('mat-hivis', 2 * T + 14, 18, 2 * T + 14, t3(0, -H - 9, 0)), // crown block
    box('mat-steel', 6, 30, 6, t3(0, -H - 33, 0)), // gin pole
    h('div', { class: 'g3 beacon', css: { transform: t3(0, -H - 50, 0) } }),
  );
}

/** Crossed planes make a volumetric-looking flame. */
function flame(cls) {
  return group(`flame ${cls}`, '',
    plane('flame-plane', 120, 230, 'translateY(-100px)'),
    plane('flame-plane', 120, 230, 'translateY(-100px) rotateY(90deg)'),
    plane('flame-plane flame-core', 56, 120, 'translateY(-52px) rotateY(45deg)'),
    h('div', { class: 'g3 flare-glow' }),
  );
}

function crane(x, z, slew) {
  return group('crane', t3(x, DECK, z), group('crane-slew', `rotateY(${slew}deg)`,
    box('mat-hivis', 26, 70, 26, t3(0, -35, 0)),
    box('mat-white', 34, 24, 30, t3(0, -82, 0), { faces: { front: 'cab-window' } }),
    group('crane-boom', `${t3(0, -90, 0)} rotateZ(-58deg)`,
      latticeColumn('lattice-yellow', 12, 210, t3(0, -105, 0))),
  ));
}

function boat() {
  return group('boat', t3(820, -8, 0),
    box('mat-boat', 160, 24, 46, t3(0, 0, 0), { faces: { front: 'boat-name' } }),
    box('mat-white', 40, 34, 40, t3(52, -29, 0), { faces: { front: 'cab-window', back: 'cab-window' } }),
    box('mat-container-a', 34, 16, 18, t3(-20, -20, -10)),
    box('mat-container-b', 34, 16, 18, t3(-58, -20, 8)),
    box('mat-container-c', 34, 16, 18, t3(-20, -20, 12)),
  );
}

function strata() {
  const kids = FORMATIONS.map((f) => {
    const top = ftToY(f.top), base = ftToY(f.base);
    const hgt = base - top;
    return group(`stratum stratum-${f.id}`, t3(0, top + hgt / 2, 0),
      plane(`stratum-face stratum-${f.id}`, 760, hgt, 'translateZ(260px)', h('span', { class: 'stratum-label' }, f.name)),
      plane(`stratum-face stratum-${f.id} side-right`, 520, hgt, 'rotateY(90deg) translateZ(380px)'),
      plane(`stratum-face stratum-${f.id} side-left`, 520, hgt, 'rotateY(-90deg) translateZ(380px)'),
      plane(`stratum-face stratum-${f.id} side-back`, 760, hgt, 'rotateY(180deg) translateZ(260px)'),
    );
  });
  return group('subsurface', '', ...kids);
}

export function createRig(stage, { reducedMotion = false } = {}) {
  const refs = {};
  const ref = (name) => (el) => { refs[name] = el; };

  const legs = LEGS.map(([x, z], i) => {
    const hgt = SEABED - (DECK - 380);
    return group('leg', '',
      latticeColumn('lattice-leg', 36, hgt, t3(x, SEABED - hgt / 2, z)),
      box('mat-yellow', 84, 22, 84, t3(x, SEABED - 11, z)), // spud can
      box('mat-hivis', 50, 30, 50, t3(x, DECK - 20, z)), // jacking house
      plane('foam', 120, 120, `${t3(x, -1, z)} rotateX(90deg)`),
      h('div', { class: 'g3 leg-light', css: { transform: t3(x, DECK - 382, z) }, dataset: { i: String(i) } }),
    );
  });

  const pipeRack = group('pipe-rack', t3(120, DECK, -70),
    box('mat-steel', 160, 8, 60, t3(0, -4, 0)),
    ...[-20, -8, 4, 16].flatMap((z, i) => [box('mat-pipe', 150, 7, 7, t3(0, -12, z)), i < 3 ? box('mat-pipe', 150, 7, 7, t3(0, -19, z + 6)) : null]).filter(Boolean),
  );

  const lq = group('lq', t3(130, DECK, 95),
    box('mat-white', 130, 92, 110, t3(0, -46, 0), { faces: { front: 'windows', right: 'windows', left: 'windows', back: 'windows' } }),
    // helideck overhangs the living quarters
    box('mat-steel', 6, 18, 6, t3(40, -101, 40)), box('mat-steel', 6, 18, 6, t3(-40, -101, 40)),
    group('helideck', t3(30, -112, 40), plane('helideck-top', 170, 170, 'rotateX(90deg)', h('span', { class: 'helideck-h', 'aria-hidden': 'true' }))),
  );

  const flareBoom = group('flare-boom', `${t3(-215, DECK - 10, -130)} rotateY(-25deg) rotateZ(22deg)`,
    group('', t3(-120, 0, 0), group('', 'rotateZ(90deg)', latticeColumn('lattice-steel', 14, 240, ''))),
    group('flare-tip', t3(-245, 0, 0), group('', 'rotateZ(-26deg)', flame('flare'))),
  );

  const crate = group('crate', t3(160, DECK - 300, 135),
    box('mat-crate', 54, 54, 54, ''),
    group('burst', '', ...Array.from({ length: 36 }, (_, i) => {
      const a = (i / 36) * Math.PI * 2, up = 0.4 + (i % 5) * 0.15;
      return h('div', { class: 'spark', css: { '--dx': `${Math.cos(a) * 160}px`, '--dy': `${-140 * up - 40}px`, '--dz': `${Math.sin(a) * 160}px`, 'animation-delay': `${(i % 6) * 0.02}s` } });
    })),
  );

  const world = h('div', { class: 'world' },
    plane('ocean', 3600, 3600, 'rotateX(90deg)', h('div', { class: 'ocean-waves' })),
    group('seabed-group', '', plane('seabed', 820, 580, `${t3(0, SEABED, 0)} rotateX(90deg)`)),
    strata(),
    // wellbore in the cutaway
    group('wellbore', t3(DERRICK.x, 0, DERRICK.z),
      h('div', { class: 'g3 well-pipe', ref: ref('wellPipe') }),
      h('div', { class: 'g3 casing casing-surface', ref: ref('casing1') }),
      h('div', { class: 'g3 casing casing-int', ref: ref('casing2') }),
      h('div', { class: 'g3 bit-glow', ref: ref('bit') }),
    ),
    ...legs,
    box('mat-hull', 440, 56, 370, t3(0, DECK + 28, 0), { faces: { front: 'hull-name', top: 'deck-grid' } }),
    box('mat-steel', 450, 6, 380, t3(0, DECK + 2, 0), { faces: { top: 'deck-grid deck-border' } }),
    // conductor from hull to seabed
    box('mat-conductor', 16, SEABED - DECK, 16, t3(DERRICK.x, (SEABED + DECK) / 2, DERRICK.z)),
    // substructure & drill floor
    box('mat-steel', 130, 80, 130, t3(DERRICK.x, DECK - 40, DERRICK.z), { faces: { front: 'substructure', back: 'substructure', left: 'substructure', right: 'substructure' } }),
    box('mat-steel', 150, 6, 150, t3(DERRICK.x, FLOOR - 3, DERRICK.z)),
    box('mat-white', 50, 36, 40, t3(DERRICK.x + 60, FLOOR - 24, DERRICK.z + 40), { faces: { front: 'cab-window', right: 'cab-window' } }), // driller's cabin
    derrick(),
    group('travelling', t3(DERRICK.x, FLOOR, DERRICK.z), group('block', '', box('mat-yellow', 26, 44, 22, t3(0, -22, 0)), h('div', { class: 'g3 drill-line' }))),
    h('div', { class: 'g3 drill-pipe', ref: ref('pipe'), css: { transform: t3(DERRICK.x, FLOOR, DERRICK.z) } }),
    // deck equipment
    pipeRack,
    box('mat-tank', 90, 40, 60, t3(-140, DECK - 20, -110)), box('mat-tank', 90, 40, 60, t3(-140, DECK - 20, -40)), // mud pits
    box('mat-pump', 60, 34, 40, t3(-60, DECK - 17, 120)), box('mat-pump', 60, 34, 40, t3(-60, DECK - 17, 165)), // mud pumps
    box('mat-hivis', 46, 22, 22, `${t3(220, DECK + 8, 40)} rotateY(90deg)`), box('mat-hivis', 46, 22, 22, `${t3(220, DECK + 8, 100)} rotateY(90deg)`), // lifeboats
    lq,
    crane(-170, 160, 30), crane(180, -150, 210),
    flareBoom,
    crate,
    group('boat-orbit', '', boat()),
  );

  const camera = h('div', { class: 'camera' }, world);
  const sky = h('div', { class: 'sky' }, h('div', { class: 'sun' }), h('div', { class: 'stars' }));
  const weather = h('div', { class: 'weather' }, h('div', { class: 'rain' }), h('div', { class: 'lightning' }));
  stage.replaceChildren(sky, h('div', { class: 'viewport' }, camera), weather);
  refs.flareBoom = flareBoom;
  refs.crate = crate;
  refs.travelling = world.querySelector('.travelling .block');

  // ---------------- camera orbit
  const cam = { yaw: -32, tilt: -16, zoom: 1, y: 230, auto: !reducedMotion, idle: 0, xray: false };
  const pointers = new Map();
  let pinch = 0;
  const viewport = stage.querySelector('.viewport');
  viewport.addEventListener('pointerdown', (e) => { pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); viewport.setPointerCapture(e.pointerId); cam.idle = 0; });
  const up = (e) => { pointers.delete(e.pointerId); pinch = 0; };
  viewport.addEventListener('pointerup', up);
  viewport.addEventListener('pointercancel', up);
  viewport.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cam.idle = 0;
    if (pointers.size === 1) {
      cam.yaw += (e.clientX - p.x) * 0.3;
      cam.tilt = Math.max(-60, Math.min(8, cam.tilt - (e.clientY - p.y) * 0.25));
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) cam.zoom = Math.max(0.45, Math.min(2.2, cam.zoom * (d / pinch)));
      pinch = d;
    }
  });
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.zoom = Math.max(0.45, Math.min(2.2, cam.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
    cam.idle = 0;
  }, { passive: false });
  // Keyboard orbit for accessibility (the viewport is focusable)
  viewport.tabIndex = 0;
  viewport.setAttribute('aria-label', '3D rig view. Arrow keys rotate, plus and minus zoom.');
  viewport.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: () => (cam.yaw -= 6), ArrowRight: () => (cam.yaw += 6), ArrowUp: () => (cam.tilt = Math.max(-60, cam.tilt - 4)),
      ArrowDown: () => (cam.tilt = Math.min(8, cam.tilt + 4)), '+': () => (cam.zoom = Math.min(2.2, cam.zoom * 1.1)), '=': () => (cam.zoom = Math.min(2.2, cam.zoom * 1.1)), '-': () => (cam.zoom = Math.max(0.45, cam.zoom / 1.1)) }[e.key];
    if (k) { k(); cam.idle = 0; e.preventDefault(); }
  });

  // ---------------- state
  let depthFt = 0;
  let blockPhase = 0;

  function frame(dt, s) {
    cam.idle += dt;
    if (cam.auto && cam.idle > 5 && !s.busy) cam.yaw += dt * 2.2;
    const fitScale = Math.min(1, Math.min(stage.clientWidth / 1650, stage.clientHeight / 1080));
    const base = (cam.xray ? 0.6 : 1) * cam.zoom * Math.max(0.36, fitScale);
    const targetY = cam.xray ? -300 : 210;
    cam.y += (targetY - cam.y) * Math.min(1, dt * 3);
    camera.style.transform = `scale(${base.toFixed(3)}) rotateX(${cam.tilt.toFixed(2)}deg) rotateY(${cam.yaw.toFixed(2)}deg) translateY(${cam.y.toFixed(1)}px)`;

    // travelling block bobs while drilling
    if (s.drilling) blockPhase += dt * 0.9;
    const blockY = s.drilling ? -40 - (Math.sin(blockPhase) * 0.5 + 0.5) * (DERRICK.height - 90) : -(DERRICK.height - 40);
    refs.travelling.style.transform = t3(0, blockY, 0);
  }

  function setDepth(ft) {
    depthFt = ft;
    const bitY = ftToY(ft);
    const len = Math.max(0, bitY - FLOOR);
    refs.pipe.style.height = px(Math.max(len, SEABED - FLOOR));
    const wellLen = Math.max(0, bitY - SEABED);
    refs.wellPipe.style.cssText = `transform: ${t3(0, SEABED, 0)}; height: ${px(wellLen)}`;
    refs.bit.style.transform = t3(0, Math.max(SEABED, bitY), 0);
    refs.bit.classList.toggle('in-reservoir', ft >= 7200);
  }

  function setCasing(shoe) {
    refs.casing1.style.cssText = `transform: ${t3(0, SEABED, 0)}; height: ${px(shoe >= 2500 ? ftToY(2500) - SEABED : 0)}`;
    refs.casing2.style.cssText = `transform: ${t3(0, SEABED, 0)}; height: ${px(shoe >= 5000 ? ftToY(5000) - SEABED : 0)}`;
  }

  function setState(s) {
    stage.classList.toggle('is-drilling', !!s.drilling);
    stage.classList.toggle('is-producing', !!s.producing);
    stage.classList.toggle('xray', !!s.xray);
    cam.xray = !!s.xray;
    stage.style.setProperty('--oil', String(Math.max(0, Math.min(1, s.oilFill ?? 1))));
    if (s.derrick) stage.style.setProperty('--derrick', s.derrick); else stage.style.removeProperty('--derrick');
    if (s.flare) stage.style.setProperty('--flare', s.flare); else stage.style.removeProperty('--flare');
    stage.classList.toggle('skin-glow', !!s.derrickGlow);
  }

  /** Day/night: t in [0,1), 0 = midnight, 0.5 = noon. */
  function setTimeOfDay(t) {
    const sunHeight = Math.sin((t - 0.25) * Math.PI * 2); // -1 midnight .. 1 noon
    const day = Math.max(0, Math.min(1, (sunHeight + 0.2) / 0.6));
    stage.style.setProperty('--day', day.toFixed(3));
    stage.style.setProperty('--dark', `${Math.round((1 - day) * 58)}%`);
    stage.style.setProperty('--sun-x', `${(t * 140 - 20).toFixed(1)}%`);
    stage.style.setProperty('--sun-y', `${(62 - sunHeight * 52).toFixed(1)}%`);
    stage.classList.toggle('night', day < 0.35);
  }

  function setStorm(on) { stage.classList.toggle('storm', on); }

  function playCrate(color, fast) {
    return new Promise((resolve) => {
      const c = refs.crate;
      c.style.setProperty('--rar', color);
      c.classList.remove('play', 'fast');
      void c.offsetWidth; // restart animation
      c.classList.add('play');
      if (fast || reducedMotion) c.classList.add('fast');
      cam.idle = 0;
      setTimeout(resolve, fast || reducedMotion ? 1300 : 3400);
    });
  }

  setDepth(0);
  setCasing(0);
  setTimeOfDay(0.4);
  return { frame, setDepth, setCasing, setState, setTimeOfDay, setStorm, playCrate, get depth() { return depthFt; } };
}
