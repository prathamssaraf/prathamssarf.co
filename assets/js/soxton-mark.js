// Soxton "s" logo tile on the Experience entry (the owner's employer). The
// letter is signed on, since signing is the core act of a legal company: a
// pen dot writes the stroke's spine from the upper terminal to the lower one
// and leaves a dotted trail, then every fill dot grows out from its trail dot
// to its place. Idle: a signal runs down the spine every few seconds, the dots
// breathe a little and swell toward a nearby pointer. A re-sign retracts the
// fill onto the spine as a faint dotted guide and the pen signs it again. A
// click or tap on the entry always re-signs; a hover does so only when the
// pointer rests on the tile or the title block, not right after a scroll, and
// at least 8 s after the last signing, so the letter never wipes itself while
// someone reads.
//
// The point data below is derived from the first glyph of the soxton.ai
// wordmark (a rows fill, N 240, and the stroke spine); no logo raster ships.
// Units: glyph half-height = 1, origin at the glyph centre, y down.

// x, y, t per dot (rows fill, N 240)
const DOTS = [
  .497,-.49,.002,.55,-.55,.005,.602,-.612,.008,.655,-.672,.011,.707,-.733,.015,.477,-.619,.027,.534,-.667,.027,.412,-.57,.028,
  .666,-.786,.029,.567,-.755,.036,.488,-.719,.042,.598,-.83,.043,.433,-.682,.045,.366,-.636,.049,.498,-.791,.051,.526,-.867,.055,
  .383,-.742,.064,.426,-.819,.066,.451,-.896,.07,.313,-.697,.072,.328,-.796,.081,.374,-.919,.085,.319,-.869,.09,.254,-.752,.093,
  .296,-.937,.1,.235,-.865,.107,.188,-.798,.112,.216,-.949,.116,.163,-.888,.123,.136,-.957,.131,.116,-.833,.132,.056,-.96,.147,
  .038,-.854,.151,-.024,-.957,.164,-.042,-.86,.169,-.104,-.95,.181,-.122,-.852,.187,-.184,-.937,.197,-.199,-.828,.207,-.262,-.917,.213,
  -.266,-.784,.227,-.338,-.89,.228,-.34,-.811,.237,-.41,-.854,.242,-.318,-.724,.249,-.384,-.752,.254,-.477,-.81,.256,-.451,-.727,.266,
  -.537,-.756,.267,-.349,-.649,.273,-.506,-.667,.281,-.587,-.693,.281,-.428,-.63,.283,-.356,-.569,.292,-.625,-.623,.296,-.548,-.598,.296,
  -.435,-.549,.301,-.339,-.491,.309,-.501,-.517,.311,-.652,-.547,.311,-.575,-.521,.313,-.417,-.47,.318,-.667,-.468,.325,-.491,-.441,.327,
  -.587,-.441,.327,-.297,-.423,.329,-.669,-.387,.336,-.38,-.398,.34,-.586,-.36,.341,-.516,-.371,.341,-.662,-.307,.344,-.572,-.28,.352,
  -.641,-.23,.353,-.495,-.304,.354,-.432,-.332,.355,-.608,-.156,.364,-.542,-.204,.364,-.463,-.23,.369,-.326,-.337,.373,-.561,-.091,.375,
  -.376,-.273,.375,-.495,-.138,.377,-.41,-.169,.385,-.503,-.035,.387,-.237,-.369,.389,-.434,-.084,.391,-.312,-.224,.395,-.261,-.287,.396,
  -.437,.012,.399,-.344,-.121,.401,-.366,-.041,.405,-.367,.05,.412,-.241,-.183,.414,-.168,-.327,.414,-.272,-.085,.417,-.19,-.248,.418,
  -.293,-.005,.421,-.293,.083,.427,-.168,-.149,.432,-.197,-.054,.434,-.095,-.294,.435,-.217,.025,.437,-.116,-.215,.438,-.218,.111,.442,
  -.092,-.12,.451,-.12,-.027,.452,-.14,.051,.453,-.019,-.266,.455,-.04,-.188,.456,-.141,.136,.459,-.015,-.094,.468,-.043,-.003,.469,
  -.063,.076,.47,.057,-.24,.473,.038,-.162,.475,-.065,.16,.476,.062,-.069,.486,.035,.021,.487,.015,.099,.488,.134,-.216,.491,
  .115,-.137,.492,.013,.183,.493,.139,-.044,.504,.112,.045,.504,.093,.123,.506,.21,-.191,.507,.193,-.112,.51,.089,.207,.511,
  .216,-.018,.521,.189,.071,.522,.286,-.165,.524,.17,.15,.525,.269,-.085,.526,.165,.235,.531,.292,.011,.538,.361,-.135,.539,
  .264,.101,.54,.344,-.054,.543,.245,.181,.544,.239,.267,.552,.434,-.101,.553,.365,.046,.555,.418,-.018,.558,.338,.136,.559,
  .317,.218,.565,.504,-.061,.568,.435,.087,.572,.487,.024,.573,.308,.308,.576,.406,.179,.578,.569,-.015,.58,.384,.264,.587,
  .549,.076,.588,.497,.139,.588,.628,.041,.593,.468,.232,.597,.601,.138,.601,.676,.105,.603,.546,.203,.603,.369,.361,.611,
  .639,.21,.613,.713,.177,.614,.442,.321,.614,.521,.292,.617,.592,.269,.619,.738,.253,.624,.662,.288,.626,.573,.356,.634,
  .751,.332,.634,.671,.369,.638,.486,.389,.641,.753,.413,.645,.573,.436,.652,.669,.45,.652,.414,.427,.656,.744,.493,.658,
  .512,.466,.661,.651,.529,.668,.722,.57,.673,.436,.504,.674,.546,.562,.68,.618,.603,.684,.688,.643,.688,.437,.584,.692,
  .5,.634,.698,.571,.669,.7,.642,.709,.703,.418,.662,.713,.588,.769,.715,.49,.712,.715,.525,.819,.728,.44,.776,.733,
  .377,.731,.736,.457,.862,.742,.377,.826,.75,.384,.896,.756,.319,.787,.757,.308,.922,.772,.25,.827,.777,.23,.941,.788,
  .173,.852,.796,.15,.954,.804,.093,.86,.815,.07,.959,.821,.013,.854,.833,-.01,.959,.837,-.064,.833,.852,-.09,.952,.853,
  -.17,.941,.869,-.136,.796,.872,-.168,.871,.873,-.249,.924,.884,-.243,.839,.891,-.201,.749,.891,-.326,.902,.9,-.26,.694,.911,
  -.402,.876,.915,-.357,.806,.915,-.323,.744,.917,-.476,.845,.93,-.313,.633,.931,-.434,.775,.932,-.377,.681,.936,-.548,.809,.945,
  -.509,.738,.949,-.361,.569,.952,-.479,.669,.954,-.427,.615,.955,-.617,.767,.96,-.58,.695,.965,-.406,.501,.972,-.473,.546,.974,
  -.682,.72,.975,-.532,.587,.976,-.594,.625,.978,-.737,.665,.991,-.677,.61,.992,-.618,.556,.993,-.559,.501,.994,-.5,.446,.995,
];

// spine, pen order, evenly spaced by arc length (200 points)
const SPINE = [
  .611,-.571,.597,-.589,.583,-.607,.568,-.625,.554,-.643,.539,-.661,.525,-.678,.51,-.696,.494,-.713,.478,-.73,.461,-.745,.444,-.76,
  .425,-.774,.406,-.788,.387,-.8,.367,-.812,.347,-.824,.327,-.835,.306,-.845,.285,-.854,.264,-.863,.242,-.871,.22,-.878,.198,-.885,
  .176,-.89,.153,-.895,.131,-.899,.108,-.903,.085,-.905,.062,-.906,.039,-.907,.015,-.907,-.007,-.906,-.031,-.905,-.054,-.903,-.077,-.901,
  -.1,-.899,-.122,-.896,-.145,-.893,-.168,-.888,-.191,-.883,-.213,-.877,-.234,-.87,-.256,-.861,-.277,-.851,-.297,-.84,-.317,-.828,-.335,-.814,
  -.353,-.799,-.369,-.783,-.385,-.766,-.398,-.747,-.41,-.728,-.421,-.707,-.43,-.686,-.438,-.664,-.446,-.642,-.452,-.62,-.459,-.598,-.465,-.576,
  -.47,-.553,-.476,-.531,-.48,-.508,-.485,-.486,-.489,-.463,-.491,-.44,-.492,-.417,-.491,-.394,-.487,-.371,-.48,-.349,-.472,-.328,-.461,-.307,
  -.449,-.288,-.435,-.27,-.419,-.252,-.403,-.236,-.386,-.22,-.368,-.206,-.35,-.192,-.33,-.179,-.311,-.167,-.291,-.156,-.27,-.145,-.25,-.135,
  -.229,-.125,-.208,-.116,-.186,-.106,-.165,-.098,-.143,-.089,-.122,-.081,-.1,-.073,-.078,-.066,-.057,-.058,-.035,-.051,-.013,-.043,.009,-.036,
  .031,-.029,.053,-.022,.075,-.014,.097,-.007,.118,0,.14,.008,.162,.016,.184,.024,.205,.032,.227,.04,.248,.048,.27,.057,
  .291,.067,.312,.076,.333,.086,.353,.097,.373,.108,.393,.12,.412,.133,.431,.146,.449,.16,.467,.175,.484,.191,.5,.208,
  .514,.225,.528,.244,.54,.264,.551,.284,.56,.305,.567,.327,.572,.35,.575,.373,.576,.396,.575,.419,.572,.442,.568,.464,
  .564,.487,.559,.509,.554,.532,.548,.554,.542,.577,.536,.599,.529,.621,.522,.643,.513,.664,.504,.686,.494,.706,.482,.726,
  .468,.745,.453,.762,.438,.779,.42,.794,.403,.809,.384,.822,.364,.835,.344,.846,.323,.856,.302,.865,.28,.873,.258,.88,
  .236,.886,.213,.891,.191,.895,.168,.898,.145,.901,.122,.903,.099,.904,.076,.905,.053,.906,.03,.906,.007,.905,-.016,.904,
  -.039,.902,-.062,.898,-.085,.894,-.107,.889,-.13,.883,-.152,.876,-.173,.869,-.195,.861,-.216,.852,-.237,.842,-.258,.832,-.278,.821,
  -.298,.809,-.318,.797,-.337,.785,-.356,.772,-.375,.758,-.394,.744,-.412,.73,-.429,.715,-.447,.7,-.464,.684,-.48,.668,-.496,.651,
  -.512,.634,-.527,.617,-.542,.6,-.557,.582,-.572,.564,-.587,.547,-.601,.529,-.616,.511,
];

const TAU = Math.PI * 2;
const BRAND = [70, 140, 255]; // #468CFF, the Soxton blue (never altered)
const INK = [31, 95, 214]; // #1F5FD6, the pen and the signal
const GUIDE = [190, 215, 255]; // the faint dotted guide during a re-sign

// Geometry. Glyph units: half-height = 1.
const GLYPH = 0.68; // glyph height / tile side
const PITCH = 0.0808; // centre-to-centre dot spacing of the fill
const DOT_R = 0.4; // dot radius / pitch (the fill's safe maximum)
const PEN_R = 1.9; // pen radius / dot radius
const SLOT_GAP = 1.25; // trail dot spacing / pitch

// Timing, seconds.
const INTRO = { pop: 0.12, write0: 0.1, write: 0.8, penOut: 0.1, grow0: 0.82, spread: 0.3, along: 0.05, grow: 0.38 };
const RESIGN = { retract: 0.16, stagger: 0.08, penIn: 0.18, write0: 0.24, write: 0.5, lag: 0.02, spread: 0.05, grow: 0.29 };
const SIGNAL = { first: 0.9, every: 3.5, dur: 1.2, lead: 0.03, tail: 0.09, swell: 0.42 };
const START_DELAY = 0.08; // after the entry has revealed, so the fade never hides the pen
const LEVELS = 8; // colour steps each side of the brand blue

// Hover re-sign guards, milliseconds. Hover (not a click) re-signs only when
// the pointer rests on the tile or the title block, the page has not just
// scrolled under a still mouse, and the letter has stood formed for a while.
const COOLDOWN_MS = 8000; // since the last signing (intro or re-sign) ended
const SCROLL_QUIET_MS = 300; // a pointerenter this soon after a scroll is ignored
const DWELL_MS = 150; // the pointer must stay this long; a pass across does nothing

// Full device resolution up to 3x, so 3x phones get crisp dots too.
const dprNow = () => Math.min(window.devicePixelRatio || 1, 3);

// ------------------------------------------------------------------ easing

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const cubicIn = (t) => t * t * t;
const cubicInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const sineInOut = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const smooth = (t) => t * t * (3 - 2 * t);
// Pen: eased in and out, fastest through the long middle stroke of the s.
const penEase = (p) => 0.3 * p + 0.7 * cubicInOut(p);

// ------------------------------------------------------------------ geometry

const N = DOTS.length / 3;
const SN = SPINE.length / 2;

function spineAt(t, out) {
  const f = clamp01(t) * (SN - 1);
  const i = Math.min(Math.floor(f), SN - 2);
  const a = f - i;
  out[0] = SPINE[2 * i] * (1 - a) + SPINE[2 * i + 2] * a;
  out[1] = SPINE[2 * i + 1] * (1 - a) + SPINE[2 * i + 3] * a;
  return out;
}

// Time at which a pen that starts at t0 and takes dur seconds reaches spine
// position u (bisection on the monotonic ease).
function passTime(u, t0, dur) {
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (penEase(mid) < u) lo = mid;
    else hi = mid;
  }
  return t0 + hi * dur;
}

const GEO = (() => {
  let len = 0;
  for (let j = 1; j < SN; j++) {
    len += Math.hypot(SPINE[2 * j] - SPINE[2 * j - 2], SPINE[2 * j + 1] - SPINE[2 * j - 1]);
  }
  // The trail: K evenly spaced dots on the spine. Every fill dot belongs to
  // the trail dot nearest its own spine position and grows out from there.
  const K = Math.max(2, Math.round(len / (PITCH * SLOT_GAP)) + 1);
  const slotX = new Float32Array(K);
  const slotY = new Float32Array(K);
  const passIntro = new Float32Array(K);
  const passResign = new Float32Array(K);
  const p = [0, 0];
  for (let k = 0; k < K; k++) {
    const u = k / (K - 1);
    spineAt(u, p);
    slotX[k] = p[0];
    slotY[k] = p[1];
    passIntro[k] = passTime(u, INTRO.write0, INTRO.write);
    passResign[k] = passTime(u, RESIGN.write0, RESIGN.write);
  }

  const tx = new Float32Array(N);
  const ty = new Float32Array(N);
  const tt = new Float32Array(N);
  const slot = new Uint16Array(N);
  const dist = new Float32Array(N);
  let dmax = 1e-6;
  for (let i = 0; i < N; i++) {
    tx[i] = DOTS[3 * i];
    ty[i] = DOTS[3 * i + 1];
    tt[i] = DOTS[3 * i + 2];
    const k = Math.round(clamp01(tt[i]) * (K - 1));
    slot[i] = k;
    dist[i] = Math.hypot(tx[i] - slotX[k], ty[i] - slotY[k]);
    dmax = Math.max(dmax, dist[i]);
  }

  const growIntro = new Float32Array(N);
  const retractAt = new Float32Array(N);
  const growResign = new Float32Array(N);
  let introEnd = 0;
  let resignEnd = 0;
  for (let i = 0; i < N; i++) {
    const dn = dist[i] / dmax;
    // Inner dots first, then outward; a touch of pen order on top.
    growIntro[i] = Math.max(INTRO.grow0 + INTRO.spread * Math.pow(dn, 0.85) + INTRO.along * tt[i], passIntro[slot[i]]);
    retractAt[i] = RESIGN.stagger * (1 - dn); // outer dots leave first, all land together
    growResign[i] = passResign[slot[i]] + RESIGN.lag + RESIGN.spread * dn;
    introEnd = Math.max(introEnd, growIntro[i] + INTRO.grow);
    resignEnd = Math.max(resignEnd, growResign[i] + RESIGN.grow);
  }
  return { K, slotX, slotY, passIntro, passResign, tx, ty, tt, slot, growIntro, retractAt, growResign, introEnd, resignEnd };
})();

// Colour buckets, from the guide tint (-1) through the brand blue (0) to ink (+1).
const mixRGB = (a, b, k) => `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * k)).join(',')})`;
const COLORS = [];
for (let l = -LEVELS; l <= LEVELS; l++) {
  COLORS.push(l < 0 ? mixRGB(BRAND, GUIDE, -l / LEVELS) : mixRGB(BRAND, INK, l / LEVELS));
}
const BRAND_CSS = COLORS[LEVELS];
const INK_CSS = COLORS[2 * LEVELS];
const bucketOf = (c) => LEVELS + Math.round(Math.max(-1, Math.min(1, c)) * LEVELS);

// ------------------------------------------------------------------ state

const marks = [];
let reduced = false;
let raf = 0;
let last = 0;
const pointer = { x: 0, y: 0, on: false };
let lastScroll = -Infinity; // performance.now() of the latest scroll anywhere

function makeMark(tile) {
  const canvas = document.createElement('canvas');
  canvas.className = 'sx-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  tile.appendChild(canvas);
  tile.classList.add('sx-live');
  return {
    tile,
    canvas,
    ctx,
    entry: tile.closest('.tl-item') || tile.parentElement,
    reveal: tile.closest('[data-reveal]'),
    signedAt: -Infinity, // performance.now() when the last signing ended
    dwell: 0,
    hot: [], // elements whose hover may re-sign (set in init)
    size: 0,
    dpr: 1,
    phase: 'wait', // wait → intro → idle ⇄ resign
    clock: 0,
    t0: 0,
    armed: false,
    goAt: -1,
    visible: false,
    sigAt: 0,
    pInf: 0,
    mx: 0,
    my: 0,
    penX: NaN,
    penY: NaN,
    x: new Float32Array(N),
    y: new Float32Array(N),
    r: new Float32Array(N),
    c: new Float32Array(N),
    px: new Float32Array(N),
    py: new Float32Array(N),
    hadPrev: false,
    blank: false,
    buckets: COLORS.map(() => new Uint16Array(N)),
    counts: new Uint16Array(COLORS.length),
  };
}

function resize(m) {
  const size = m.tile.clientWidth;
  const dpr = dprNow();
  if (!size) return;
  if (size === m.size && dpr === m.dpr) return;
  m.size = size;
  m.dpr = dpr;
  m.canvas.width = Math.round(size * dpr);
  m.canvas.height = Math.round(size * dpr);
  m.hadPrev = false;
  if (reduced || !m.visible || m.phase === 'wait') render(m);
}

function begin(m, phase) {
  m.phase = phase;
  m.t0 = m.clock;
  m.hadPrev = false;
  m.penX = NaN;
}

function settle(m) {
  begin(m, 'idle');
  m.sigAt = m.clock + SIGNAL.first;
  m.signedAt = performance.now();
}

function resign(m) {
  if (reduced || m.phase !== 'idle') return;
  clearTimeout(m.dwell);
  m.dwell = 0;
  begin(m, 'resign');
  wake();
}

const cooled = (m) => performance.now() - m.signedAt >= COOLDOWN_MS;
const scrolledJustNow = () => performance.now() - lastScroll < SCROLL_QUIET_MS;

// Hover on the tile or the title block: wait out a short dwell, then re-sign
// if the pointer is still there and every guard passes.
function hoverSign(m, e) {
  if (e.pointerType === 'touch' || reduced || scrolledJustNow() || !cooled(m)) return;
  clearTimeout(m.dwell);
  m.dwell = setTimeout(() => {
    m.dwell = 0;
    const still = m.hot.some((el) => el.matches(':hover'));
    if (still && !scrolledJustNow() && cooled(m)) resign(m);
  }, DWELL_MS);
}

// ------------------------------------------------------------------ frame

// Fills x, y (css px), r (px) and c (colour level) for every dot; returns the
// pen as [x, y, r] or null.
function compute(m, dt) {
  const G = GEO;
  const half = (m.size * GLYPH) / 2;
  const cx = m.size / 2;
  const cy = m.size / 2;
  const r0 = DOT_R * PITCH * half;
  const tau = m.clock - m.t0;
  const pen = [0, 0];
  let penR = 0;
  let penU = 0;

  if (m.phase === 'intro') {
    const w = clamp01((tau - INTRO.write0) / INTRO.write);
    penU = penEase(w);
    const out = clamp01((tau - INTRO.write0 - INTRO.write) / INTRO.penOut);
    penR = expoOut(clamp01(tau / INTRO.pop)) * (1 + 0.12 * Math.sin(Math.PI * clamp01(tau / INTRO.pop))) * (1 - smooth(out));
    for (let i = 0; i < N; i++) {
      const k = G.slot[i];
      const a = tau - G.passIntro[k];
      if (a < 0) {
        m.x[i] = G.slotX[k];
        m.y[i] = G.slotY[k];
        m.r[i] = 0;
        continue;
      }
      const g = expoOut(clamp01((tau - G.growIntro[i]) / INTRO.grow));
      m.x[i] = G.slotX[k] + (G.tx[i] - G.slotX[k]) * g;
      m.y[i] = G.slotY[k] + (G.ty[i] - G.slotY[k]) * g;
      m.r[i] = inkSize(a);
      m.c[i] = inkTone(a);
    }
    if (tau >= G.introEnd) settle(m);
  } else if (m.phase === 'resign') {
    const w = clamp01((tau - RESIGN.write0) / RESIGN.write);
    penU = penEase(w);
    const pin = clamp01((tau - RESIGN.penIn) / (RESIGN.write0 - RESIGN.penIn));
    const out = clamp01((tau - RESIGN.write0 - RESIGN.write) / 0.08);
    penR = expoOut(pin) * (1 - smooth(out));
    for (let i = 0; i < N; i++) {
      const k = G.slot[i];
      const a = tau - G.passResign[k];
      if (a < 0) {
        // Retract onto the spine and fade to the guide tint.
        const e = cubicIn(clamp01((tau - G.retractAt[i]) / RESIGN.retract));
        m.x[i] = G.tx[i] + (G.slotX[k] - G.tx[i]) * e;
        m.y[i] = G.ty[i] + (G.slotY[k] - G.ty[i]) * e;
        m.r[i] = 1 - 0.22 * e;
        m.c[i] = -e;
      } else {
        const g = expoOut(clamp01((tau - G.growResign[i]) / RESIGN.grow));
        m.x[i] = G.slotX[k] + (G.tx[i] - G.slotX[k]) * g;
        m.y[i] = G.slotY[k] + (G.ty[i] - G.slotY[k]) * g;
        m.r[i] = inkSize(a);
        m.c[i] = inkTone(a);
      }
    }
    if (tau >= G.resignEnd) settle(m);
  } else {
    // idle (also the reduced-motion still)
    const still = reduced;
    let head = -9;
    if (!still && m.clock >= m.sigAt) {
      const s = (m.clock - m.sigAt) / SIGNAL.dur;
      if (s >= 1) m.sigAt += SIGNAL.every;
      else head = -SIGNAL.lead * 3 + (1 + SIGNAL.lead * 3 + SIGNAL.tail * 4) * sineInOut(s);
    }
    const breath = m.clock * (TAU / 3.8);
    for (let i = 0; i < N; i++) {
      m.x[i] = G.tx[i];
      m.y[i] = G.ty[i];
      if (still) {
        m.r[i] = 1;
        m.c[i] = 0;
        continue;
      }
      const d = head - G.tt[i];
      const e = d >= 0 ? Math.exp(-d / SIGNAL.tail) : Math.exp(-(d * d) / (SIGNAL.lead * SIGNAL.lead));
      m.r[i] = (1 + SIGNAL.swell * e) * (1 + 0.05 * Math.sin(breath - G.tt[i] * 3));
      m.c[i] = e;
    }
  }

  // To css px.
  for (let i = 0; i < N; i++) {
    m.x[i] = cx + m.x[i] * half;
    m.y[i] = cy + m.y[i] * half;
    m.r[i] *= r0;
  }
  if (penR > 0) {
    spineAt(penU, pen);
    pen[0] = cx + pen[0] * half;
    pen[1] = cy + pen[1] * half;
  }

  // Pointer: dots near it swell and lean toward it.
  if (!reduced) {
    let target = 0;
    let mx = 0;
    let my = 0;
    if (pointer.on) {
      const rect = m.canvas.getBoundingClientRect();
      mx = ((pointer.x - rect.left) / rect.width) * m.size;
      my = ((pointer.y - rect.top) / rect.height) * m.size;
      const ox = Math.max(0, -mx, mx - m.size);
      const oy = Math.max(0, -my, my - m.size);
      target = 1 - clamp01(Math.hypot(ox, oy) / 90);
      m.mx = mx;
      m.my = my;
    }
    m.pInf += (target - m.pInf) * (1 - Math.exp(-dt * 9));
    if (m.pInf > 0.01) {
      const R = m.size * 0.42;
      for (let i = 0; i < N; i++) {
        if (m.r[i] <= 0) continue;
        const dx = m.mx - m.x[i];
        const dy = m.my - m.y[i];
        const d = Math.hypot(dx, dy);
        if (d >= R) continue;
        const f = m.pInf * smooth(1 - d / R);
        m.r[i] *= 1 + 0.35 * f;
        if (d > 0.5) {
          const lean = Math.min(0.7, d * 0.1) * f;
          m.x[i] += (dx / d) * lean;
          m.y[i] += (dy / d) * lean;
        }
      }
    }
  }
  return penR > 0 ? [pen[0], pen[1], penR * PEN_R * r0] : null;
}

// Freshly laid trail dots pop in a little large and dark, then settle.
function inkSize(a) {
  return Math.min(1, a / 0.05) * (1 + 0.3 * Math.max(0, 1 - a / 0.25));
}
function inkTone(a) {
  return Math.max(0, 1 - a / 0.3);
}

function render(m, dt = 0) {
  const { ctx, dpr, size } = m;
  if (!size) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (m.phase === 'wait' && !reduced) {
    // Blank until the signing starts; clear once, not every frame.
    if (!m.blank) ctx.clearRect(0, 0, size, size);
    m.blank = true;
    m.hadPrev = false;
    return;
  }
  ctx.clearRect(0, 0, size, size);
  m.blank = false;
  if (reduced && m.phase !== 'idle') m.phase = 'idle';
  const pen = compute(m, dt);
  const r0 = DOT_R * PITCH * ((size * GLYPH) / 2);

  // Short motion streaks behind moving dots (and the pen).
  if (m.hadPrev && !reduced && m.phase !== 'idle') {
    ctx.beginPath();
    let any = false;
    for (let i = 0; i < N; i++) {
      if (m.r[i] <= 0 || m.px[i] < -1e3) continue;
      const dx = m.x[i] - m.px[i];
      const dy = m.y[i] - m.py[i];
      if (dx * dx + dy * dy < 0.25) continue;
      ctx.moveTo(m.px[i], m.py[i]);
      ctx.lineTo(m.x[i], m.y[i]);
      any = true;
    }
    if (any) {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = BRAND_CSS;
      ctx.lineWidth = 1.2 * r0;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    if (pen && m.penX === m.penX) {
      ctx.beginPath();
      ctx.moveTo(m.penX, m.penY);
      ctx.lineTo(pen[0], pen[1]);
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = INK_CSS;
      ctx.lineWidth = 1.2 * pen[2];
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Dots, one path per colour bucket.
  m.counts.fill(0);
  for (let i = 0; i < N; i++) {
    if (m.r[i] <= 0.05) continue;
    const b = bucketOf(m.c[i]);
    m.buckets[b][m.counts[b]++] = i;
  }
  for (let b = 0; b < COLORS.length; b++) {
    const n = m.counts[b];
    if (!n) continue;
    const list = m.buckets[b];
    ctx.beginPath();
    for (let j = 0; j < n; j++) {
      const i = list[j];
      ctx.moveTo(m.x[i] + m.r[i], m.y[i]);
      ctx.arc(m.x[i], m.y[i], m.r[i], 0, TAU);
    }
    ctx.fillStyle = COLORS[b];
    ctx.fill();
  }
  if (pen) {
    ctx.beginPath();
    ctx.arc(pen[0], pen[1], pen[2], 0, TAU);
    ctx.fillStyle = INK_CSS;
    ctx.fill();
    m.penX = pen[0];
    m.penY = pen[1];
  } else {
    m.penX = NaN;
  }

  for (let i = 0; i < N; i++) {
    m.px[i] = m.r[i] > 0 ? m.x[i] : -1e4;
    m.py[i] = m.y[i];
  }
  m.hadPrev = true;
}

function step(m, dt) {
  m.clock += dt;
  if (dprNow() !== m.dpr) resize(m);
  if (m.phase === 'wait') {
    const shown = !m.reveal || m.reveal.classList.contains('is-in');
    if (m.armed && shown) {
      if (m.goAt < 0) m.goAt = m.clock + START_DELAY;
      if (m.clock >= m.goAt) begin(m, 'intro');
    }
  }
  render(m, dt);
}

function frame(now) {
  raf = 0;
  const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
  last = now;
  let live = false;
  for (const m of marks) {
    if (!m.visible) continue;
    step(m, dt);
    live = true;
  }
  if (live && !reduced && !document.hidden) raf = requestAnimationFrame(frame);
  else last = 0;
}

function wake() {
  if (raf || reduced || document.hidden || !marks.some((m) => m.visible)) return;
  last = 0;
  raf = requestAnimationFrame(frame);
}

function setReduced(on) {
  reduced = on;
  if (on && raf) {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  }
  for (const m of marks) {
    // The still is the formed letter; after it, motion resumes in idle.
    if (on || m.phase !== 'wait') {
      m.phase = 'idle';
      m.sigAt = m.clock + SIGNAL.first;
    }
    m.hadPrev = false;
    render(m);
  }
  wake();
}

// ------------------------------------------------------------------ init

export function init(opts = {}) {
  const tiles = [...document.querySelectorAll('.sx-tile')];
  if (!tiles.length) return { marks: 0 };

  const html = document.documentElement;
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const readReduced = () => html.classList.contains('reduced') || !!(mq && mq.matches);
  reduced = !!opts.reduced || readReduced();

  for (const tile of tiles) {
    if (marks.some((m) => m.tile === tile)) continue;
    const m = makeMark(tile);
    if (m) marks.push(m);
  }
  if (!marks.length) return { marks: 0 };

  const hasIO = 'IntersectionObserver' in window;
  // Any pixel on screen keeps the loop running; the signing waits until the
  // whole tile is clear of the bottom tenth of the viewport.
  const io = hasIO
    ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        const m = marks.find((k) => k.tile === e.target);
        if (!m) continue;
        m.visible = e.isIntersecting;
        if (!m.visible) m.hadPrev = false;
      }
      wake();
    })
    : null;
  const arm = hasIO
    ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        const m = marks.find((k) => k.tile === e.target);
        if (!m || !e.isIntersecting) continue;
        // Fully in view, or already cut off by the top edge after a fast scroll.
        const pastTop = e.rootBounds && e.boundingClientRect.top < e.rootBounds.top;
        if (e.intersectionRatio >= 0.98 || pastTop) {
          m.armed = true;
          arm.unobserve(m.tile);
        }
      }
      wake();
    }, { rootMargin: '0px 0px -10% 0px', threshold: [0, 0.5, 0.98] })
    : null;

  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => marks.forEach(resize)) : null;
  for (const m of marks) {
    resize(m);
    if (io) {
      io.observe(m.tile);
      arm.observe(m.tile);
    } else {
      m.visible = m.armed = true;
    }
    if (ro) ro.observe(m.tile);
    // Hover re-signs only from the tile or the title block, never from the
    // rest of the entry, and only past the guards in hoverSign().
    m.hot = [m.tile, m.entry.querySelector('.tl-head')].filter(Boolean);
    for (const el of m.hot) el.addEventListener('pointerenter', (e) => hoverSign(m, e));
    // A click or tap anywhere on the entry is the explicit trigger: no dwell,
    // no cooldown. A click that ends a text selection does not count.
    m.entry.addEventListener('click', () => {
      const sel = window.getSelection ? window.getSelection() : null;
      if (sel && !sel.isCollapsed && m.entry.contains(sel.anchorNode)) return;
      resign(m);
    });
    m.entry.addEventListener('focusin', () => {
      if (cooled(m)) resign(m);
    });
  }
  if (!ro) window.addEventListener('resize', () => marks.forEach(resize));
  // Capture phase, so scrolls of any container count, not just the page.
  window.addEventListener('scroll', () => (lastScroll = performance.now()), { passive: true, capture: true });

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.on = true;
  }, { passive: true });
  window.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) pointer.on = false;
  });
  window.addEventListener('blur', () => (pointer.on = false));

  window.addEventListener('motion:change', (e) => {
    const on = e.detail && typeof e.detail.reduced === 'boolean' ? e.detail.reduced : readReduced();
    if (on !== reduced) setReduced(on);
  });
  if (mq && mq.addEventListener) {
    mq.addEventListener('change', () => {
      const on = readReduced();
      if (on !== reduced) setReduced(on);
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) wake();
  });

  if (reduced) setReduced(true);
  wake();
  return { marks: marks.length };
}
