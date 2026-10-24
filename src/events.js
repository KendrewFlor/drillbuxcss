// Operational events: HSE, weather and spills. Pure data + probability helpers.

export const HSE_EVENTS = [
  {
    id: 'h2s',
    title: 'H₂S alarm — 10 ppm at the shale shaker',
    body: 'The fixed gas detector at the shakers is reading 10 ppm hydrogen sulphide and climbing.',
    safe: { label: 'Stop the job, muster, mask up', days: 0.3, dollars: 0 },
    risky: { label: 'Carry on and monitor it', chance: 0.4, days: 3, dollars: 3_000_000, outcome: 'Two crew members were overcome at the shakers and medevaced. Operations shut down for the investigation.' },
  },
  {
    id: 'dropped',
    title: 'Dropped object — pin missing on derrick board',
    body: 'A walk-around inspection found a monkey-board fitting with its securing pin missing, directly above the drill floor.',
    safe: { label: 'Stop work, secure the derrick, re-inspect', days: 0.2, dollars: 0 },
    risky: { label: 'Note it for the next maintenance window', chance: 0.25, days: 2, dollars: 2_000_000, outcome: 'The fitting fell 90 ft onto the drill floor. A roughneck was injured and the floor equipment was damaged.' },
  },
  {
    id: 'ptw',
    title: 'Permit-to-work — welding without a hot-work permit',
    body: 'A contractor is setting up to weld near the mud pits. No hot-work permit or gas test is on the board.',
    safe: { label: 'Stop the job, gas-test, issue the permit', days: 0.25, dollars: 0 },
    risky: { label: "Let them finish, it's a quick job", chance: 0.3, days: 4, dollars: 4_000_000, outcome: 'Sparks ignited vapour at the mud pits. The fire was contained but the pit room was destroyed.' },
  },
  {
    id: 'crane',
    title: 'Crane lift — wind gusting above the lift limit',
    body: 'The supply boat is waiting for a casing lift, but gusts are 5 knots above the crane’s lift limit.',
    safe: { label: 'Suspend the lift until the wind drops', days: 0.15, dollars: 0 },
    risky: { label: 'Make the lift with extra taglines', chance: 0.3, days: 1.5, dollars: 2_500_000, outcome: 'The load swung into the boat’s deck crane. Both cranes are out of service pending inspection.' },
  },
];

export const WEATHER = {
  title: 'Storm warning — significant wave height 6 m',
  body: 'The met service forecasts a tropical storm passing within 60 nautical miles in the next 24 hours.',
  safe: { label: 'Wait on weather — secure the rig', minDays: 1, maxDays: 3 },
  risky: { label: 'Keep operating through it', chance: 0.35, days: 2, dollars: 2_500_000, outcome: 'Green water hit the drill floor. Equipment was damaged and the riser tensioners need inspection.' },
};

export const SPILL = {
  title: 'Flowline leak — oil on the seabed and shoreline',
  body: 'A corroded flowline released crude. It has reached the shoreline sediment near the tank farm.',
  options: [
    { id: 'excavate', label: 'Excavate & dispose of soil', days: 2, dollars: 3_500_000, blurb: 'Fast and certain, but expensive and it just moves the problem to a landfill.' },
    { id: 'bioremediate', label: 'Bioremediation (biochar-amended)', days: 6, dollars: 1_400_000, blurb: 'Nutrient-loaded biochar feeds native hydrocarbon-degrading microbes. Slower, cheaper, treats it on site.' },
    { id: 'ignore', label: 'Report it and do nothing', days: 0, dollars: 0, fineChance: 0.8, fine: 9_000_000, blurb: 'The regulator will very likely fine you.' },
  ],
};

export const RATES = {
  hsePerRigDay: 0.05,
  hsePerProdDay: 0.001,
  weatherPerDay: 0.015,
  weatherPerProdDay: 0.0008,
  spillPerProdDay: 0.00025,
};

/** Probability that at least one event occurs in `days` at a per-day rate. */
export function chanceIn(days, perDay) {
  return 1 - Math.pow(1 - perDay, days);
}
