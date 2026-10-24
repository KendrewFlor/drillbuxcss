# The petroleum engineering model

Every model is a pure function in `src/` with a test against a hand calculation in `tests/`. Oilfield units throughout.

## 1. Pressure and the drilling window

### Stratigraphic column

| Formation              | Depth (ft)  | Pore gradient (psi/ft) | Fracture gradient (psi/ft) | Hardness |
|------------------------|-------------|------------------------|----------------------------|----------|
| Recent alluvium & clay | 0–2,500     | 0.465                  | 0.70                       | 1.0      |
| Miocene sand–shale     | 2,500–5,000 | 0.465                  | 0.75                       | 1.4      |
| Overpressured shale    | 5,000–6,800 | 0.60                   | 0.82                       | 1.8      |
| Cap rock (limestone)   | 6,800–7,200 | 0.52                   | 0.85                       | 2.2      |
| Reservoir sandstone    | 7,200–8,000 | 0.52                   | 0.80                       | 1.3      |

Casing is set automatically at 2,500 ft (13⅜″) and 5,000 ft (9⅝″).

### Hydrostatic pressure

$$P_h = 0.052 \times MW \times TVD$$

### Kick and loss conditions

**Kick:** static mud hydrostatic pressure falls below pore pressure.

$$P_h < G_{pore} \times TVD$$

**Lost circulation:** while circulating, ECD exceeds the weakest fracture gradient in the open hole between the casing shoe and the bit.

$$ECD > \min_{\text{open hole}} \frac{G_{frac}}{0.052}$$

### MAASP

$$MAASP = \left(\frac{G_{frac,\,shoe}}{0.052} - MW\right) \times 0.052 \times TVD_{shoe}$$

## 2. Drilling hydraulics

The well is an 8½″ hole with 5″ drill pipe. Pressure losses are calibrated power-law fits: simplified for a game, but each one moves the right way for the right reason.

**Annular velocity**

$$AV = \frac{24.5\,Q}{D_h^2 - D_p^2} \quad \text{(ft/min, } Q \text{ in gpm)}$$

**Equivalent circulating density**

$$ECD = MW + \frac{\Delta P_{annulus}}{0.052 \times TVD}$$

**Bit pressure drop**

$$\Delta P_{bit} = \frac{MW\,Q^2}{12{,}032 \times TFA^2}$$

**Hydraulic horsepower per square inch**

$$HSI = \frac{\Delta P_{bit}\,Q / 1714}{A_{bit}}$$

**Standpipe pressure**

$$SPP = 100 + \Delta P_{string} + \Delta P_{bit} + \Delta P_{annulus}$$

The pump limit is 4,500 psi.

**Hole cleaning.** Cuttings accumulate whenever

$$AV < 100 + 0.5 \times ROP$$

and the pipe packs off (stuck) when they reach 100%.

**Rate of penetration**

$$ROP = \frac{95}{H} \cdot M_{bit} \cdot \frac{1}{1 + 0.08\,\Delta MW_{ob}} \cdot \left(0.8 + 0.3\min\left(1, \frac{HSI}{6}\right)\right)$$

The factors, in order, are:
- formation hardness $H$,
- the bit's multiplier $M_{bit}$,
- chip hold-down from overbalance $\Delta MW_{ob}$,
- jetting from bit hydraulics.

## 3. Well control (IWCF)

### Influx identification

**Influx height**

$$h_{influx} = \frac{\text{Pit gain}}{C_{ann}}, \qquad C_{ann} = \frac{D_h^2 - D_p^2}{1029.4} = 0.0459 \text{ bbl/ft}$$

**Influx gradient**

$$G_{influx} = 0.052\,MW - \frac{SICP - SIDPP}{h_{influx}}$$

The influx type follows from the gradient:

| Gradient (psi/ft) | Influx |
|---|---|
| Below 0.25 | Gas |
| 0.25–0.4 | Oil or mixed |
| Above 0.4 | Salt water |

### Kill sheet

**Kill mud weight** (rounded up to the next 0.1 ppg)

$$KMW = OMW + \frac{SIDPP}{0.052 \times TVD}$$

**Initial circulating pressure**

$$ICP = SCR + SIDPP$$

**Final circulating pressure**

$$FCP = SCR \times \frac{KMW}{OMW}$$

**Strokes surface to bit**

$$\frac{0.01776 \times TVD}{0.1}$$

**Strokes bit to surface**

$$\frac{C_{ann} \times TVD}{0.1}$$

### The choke simulator (`src/wellcontrol.js`)

The game schedules drill-pipe pressure **from the player's own sheet**:
- it drops linearly from ICP to FCP while kill mud travels to the bit,
- then holds FCP.

Under the hood, the *correct* schedule decides the real bottom-hole pressure. The required choke opening drifts as the circulation proceeds, and the gas expansion near surface forces the player to close in and then open up. As a result:
- following a wrong ICP perfectly still underbalances the well and causes a secondary influx;
- kill mud that is too light means the well flows on the flow check, so it must be killed again;
- casing pressure above MAASP fractures the shoe.

The grade is based on RMS bottom-hole pressure error:

| Grade | RMS error |
|---|---|
| A | Under 40 psi |
| B | Under 80 psi |
| C | Under 140 psi |

The two methods compare like this:

| Method | Circulations | Rig days | Casing-pressure peak |
|---|---|---|---|
| Driller's | Two | About 2.0 | Higher |
| Wait & Weight | One | About 1.6 | Lower |

## 4. Reservoir and production

**Volumetric OOIP**

$$N = \frac{7758\,A\,h\,\phi\,(1 - S_w)}{B_o}$$

**Pseudo-steady-state radial inflow**

$$q = \frac{0.00708\,k\,h\,(\bar P_r - P_{wf})}{\mu B_o\,[\ln(r_e/r_w) - 0.75 + s]}$$

Skin starts at +2 from drilling damage.

**Reserves-limited rate.** A well can't produce faster than its reserves allow. The rate cap is the initial rate whose 10-year Arps decline recovers exactly the EUR:

$$q_{cap} = \frac{EUR}{N_p^{Arps}(q_i = 1,\; t = 3650\text{ d})}$$

The initial rate is the smaller of the Darcy rate and $q_{cap}$:
- **Deliverability-limited wells** benefit from stimulation (lower skin).
- **Reserves-limited wells** benefit from EOR (higher EUR).

**Arps decline**

$$q(t) = \frac{q_i}{(1 + b\,D_i\,t)^{1/b}}$$

**Choke.** Bean size scales today's rate and the decline clock. A 48/64″ choke gives ×1.15 rate but ×1.25 decline speed.

**Natural flow.** Natural flow fades after 35% of EUR is produced, which is when artificial lift becomes worth it.

| Lift | Capex | Opex | Rate factor | Limit |
|---|---|---|---|---|
| Rod pump | $0.8M | $3k/day | ×1.0 | 1,500 STB/d |
| Gas lift | $1.5M | $5k/day | ×1.1 | none |
| ESP | $2.5M | $8k/day | ×1.25 | none |

**Water cut** starts at a random breakthrough point, 25–45% of EUR, and rises to at most 95%. Water costs $2.50/bbl trucked, or $0.80/bbl with a $2M treatment plant.

**EOR items** add recovery-factor points:

| Item | Recovery |
|---|---|
| Gas lift mandrels | +2 points, and P<sub>wf</sub> −200 psi |
| Waterflood | +10 points |
| Polymer flood | +14 points |
| CO₂ miscible | +20 points |

**Economic limit.** The well is shut in after 60 consecutive days of negative net cash flow, once it has produced for at least 180 days.

## 5. Economics (`src/finance.js`)

**Oil price** follows a mean-reverting (Ornstein–Uhlenbeck) process in log price, around $78/bbl with σ = 30%/yr and a reversion speed of 1.2/yr, clamped to $25–180:

$$d\ln P = \kappa(\ln\bar P - \ln P)\,dt + \sigma\,dW$$

**Field ledger.** Drilling, casing, completion and facilities capex ($4M completion plus a $16M tie-back) fall in **year 0**. Production revenue and opex fall in years 1, 2, 3 and so on, and P&A in the final year. This matches the textbook cash flow diagram convention.

Revenue is net of a 12.5% royalty. Opex is $14/bbl lifting, $25k/day fixed, plus lift and water costs.

**Net present value** at 10%

$$NPV = \sum_t \frac{CF_t}{(1.1)^t}$$

**IRR** solves

$$NPV(r) = 0$$

by scanning from high rates downward, then bisecting. That finds the economically meaningful root even when the P&A year makes the final cash flow negative.

**Payback** is interpolated within the year the cumulative cash flow turns positive.

**Profitability index**

$$PI = \frac{PV(\text{inflows})}{PV(\text{outflows})}$$

**Crate spending** from the field budget is tracked separately, so the report can show NPV with and without it.

## 6. The crate maths (`src/economy.js`)

- Base legendary odds are 0.8%.
- Soft pity starts at pull 74 and adds 6 points per pull; hard pity is at 90.
- Expected pulls per legendary:

$$E[n] = \sum_{n=1}^{90} n\,p_n\prod_{k<n}(1 - p_k) \approx 58.1$$

  This is checked by a 400,000-pull Monte Carlo test.
- Bundle sizes (450, 1,000, 2,100 and 5,500 Drillbux) never divide evenly into 300-Drillbux crates.
