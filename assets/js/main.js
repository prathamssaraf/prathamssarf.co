// Boot. Flags the document for JS, wires the menu and the pause-motion
// toggle, tracks reduced motion live (holding the visitor's place when that
// reflows the page), then starts every feature module in
// isolation: a module that is missing, fails to parse, never arrives, or
// throws in init() is skipped with one console.warn and the rest still run.

// ball before hero / catalogue / awards: they hand the one ball between them.
const MODULES = ['scenes', 'dots', 'ball', 'hero', 'catalogue', 'awards', 'hud', 'type', 'gizmo', 'soxton-mark', 'rings'];
const IMPORT_TIMEOUT_MS = 6000;
const MOTION_KEY = 'motion';
const root = document.documentElement;

root.classList.add('js');

const motionQuery = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

// The visitor's own pause (the nav toggle). It only ever turns motion off,
// never back on against the OS setting.
let motionPaused = false;
try {
  motionPaused = localStorage.getItem(MOTION_KEY) === 'off';
} catch { /* storage blocked: start unpaused */ }

const isReduced = () => motionPaused || !!(motionQuery && motionQuery.matches);

// Switching motion live reflows the page: site.css collapses the tall skills
// track to one screen under html.reduced and grows it back after. Left alone,
// that carries the visitor into another section (WebKit has no scroll
// anchoring to soften it), so note the block on the centre line first and
// scroll it back into place after the switch.
function markPlace() {
  const line = window.innerHeight / 2;
  const track = document.querySelector('.rings-track');
  // Page blocks in order. The section that holds the track is split into its
  // children, so no block picked here changes height itself.
  const blocks = [...document.querySelectorAll('section.scene, .site-foot')]
    .flatMap((el) => (track && el.contains(track) ? [...el.children] : [el]));
  for (const el of blocks) {
    const r = el.getBoundingClientRect();
    if (r.bottom > line) return { el, top: r.top, inTrack: el === track && r.top <= line };
  }
  return null;
}

function restorePlace({ el, top, inTrack }, reduced) {
  // Paused while the rings were pinned: show the now static stage whole.
  const want = inTrack && reduced ? Math.max(0, top) : top;
  const dy = el.getBoundingClientRect().top - want;
  if (Math.abs(dy) >= 1) window.scrollBy(0, dy);
}

function applyMotion(announce) {
  const reduced = isReduced();
  const mark = announce && reduced !== root.classList.contains('reduced') ? markPlace() : null;
  // This code does the anchoring; the browser's own would add to it.
  if (mark) root.style.setProperty('overflow-anchor', 'none');
  root.classList.toggle('reduced', reduced);
  if (mark) {
    restorePlace(mark, reduced);
    requestAnimationFrame(() => requestAnimationFrame(() => root.style.removeProperty('overflow-anchor')));
  }
  if (announce) {
    window.dispatchEvent(new CustomEvent('motion:change', { detail: { reduced } }));
  }
}

applyMotion(false);

if (motionQuery) {
  const onMotionChange = () => applyMotion(true);
  if (typeof motionQuery.addEventListener === 'function') {
    motionQuery.addEventListener('change', onMotionChange);
  } else if (typeof motionQuery.addListener === 'function') {
    motionQuery.addListener(onMotionChange); // Safari < 14
  }
}

const describe = (err) => (err && err.message) || String(err);

// ---------------------------------------------------------------- controls

function setupMotionToggle() {
  const btn = document.querySelector('.motion-btn');
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(motionPaused));
  btn.addEventListener('click', () => {
    motionPaused = !motionPaused;
    try {
      if (motionPaused) localStorage.setItem(MOTION_KEY, 'off');
      else localStorage.removeItem(MOTION_KEY);
    } catch { /* applied, just not remembered */ }
    btn.setAttribute('aria-pressed', String(motionPaused));
    applyMotion(true);
  });
}

// Compact-screen menu: a full-screen popover. While it is open everything
// else is inert, so focus starts on Close and cannot wander behind the panel.
// Where the Popover API is missing (Safari < 17) a class toggle stands in.
function setupMenu() {
  const panel = document.getElementById('nav-panel');
  const btn = document.querySelector('.menu-btn');
  if (!panel || !btn) return;
  const nav = panel.closest('.site-nav') || panel.parentElement;
  const close = panel.querySelector('.menu-close');
  const setInert = (on) => {
    document.querySelectorAll('body > :not(.site-nav, script), .site-nav > :not(#nav-panel)')
      .forEach((n) => { n.inert = on; });
  };
  let hide;

  if ('popover' in HTMLElement.prototype) {
    // beforetoggle, not toggle: inert has to be gone before the popover hands
    // focus back to the menu button.
    panel.addEventListener('beforetoggle', (e) => setInert(e.newState === 'open'));
    panel.addEventListener('toggle', (e) => {
      if (e.newState === 'open' && close) close.focus();
    });
    hide = () => {
      if (panel.matches(':popover-open')) panel.hidePopover();
    };
  } else {
    root.classList.add('no-popover');
    btn.setAttribute('aria-controls', panel.id);
    const set = (open, refocus) => {
      panel.classList.toggle('is-open', open);
      nav.classList.toggle('is-menu-open', open);
      btn.setAttribute('aria-expanded', String(open));
      setInert(open);
      if (open && close) close.focus();
      else if (refocus) btn.focus();
    };
    set(false);
    btn.addEventListener('click', () => set(true));
    if (close) close.addEventListener('click', () => set(false, true));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('is-open')) set(false, true);
    });
    hide = () => {
      if (panel.classList.contains('is-open')) set(false);
    };
  }

  // A chosen link closes the menu (scenes.js then moves focus to its target),
  // and so does growing past the compact layout.
  panel.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('a')) hide();
  });
  const compact = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 879px)') : null;
  if (compact && typeof compact.addEventListener === 'function') {
    compact.addEventListener('change', () => {
      if (!compact.matches) hide();
    });
  }
}

[setupMotionToggle, setupMenu].forEach((setup) => {
  try {
    setup();
  } catch (e) {
    console.warn(`[site] ${setup.name}: ${describe(e)}`);
  }
});

// ---------------------------------------------------------------- modules

// A request that never completes must not hold the rest of the page hostage
// (site.css hides [data-reveal] until scenes.js runs).
function load(name) {
  const imported = import(`./${name}.js`).then(
    (mod) => ({ name, mod }),
    (err) => ({ name, err })
  );
  const timedOut = new Promise((resolve) => {
    setTimeout(() => resolve({ name, err: new Error(`no response after ${IMPORT_TIMEOUT_MS} ms`) }), IMPORT_TIMEOUT_MS);
  });
  return Promise.race([imported, timedOut]);
}

async function boot() {
  // Fetch in parallel, but init strictly in order and only once everything
  // has settled, so every listener is attached before scenes.js emits its
  // first scene:change (which it defers to after fonts + one frame).
  const loaded = await Promise.all(MODULES.map(load));
  const failed = [];

  for (const { name, mod, err } of loaded) {
    if (err) {
      failed.push(`${name} (${describe(err)})`);
      continue;
    }
    if (!mod || typeof mod.init !== 'function') {
      failed.push(`${name} (no init export)`);
      continue;
    }
    try {
      const result = mod.init({ reduced: isReduced() });
      if (result && typeof result.then === 'function') {
        result.catch((e) => console.warn(`[site] ${name} stopped: ${describe(e)}`));
      }
    } catch (e) {
      failed.push(`${name} (${describe(e)})`);
    }
  }

  if (failed.length) {
    console.warn(`[site] running without: ${failed.join(', ')}`);
    // site.css hides [data-reveal] blocks in JS mode until scenes.js marks
    // them .is-in; without scenes.js they must not stay hidden.
    if (failed.some((f) => f.startsWith('scenes '))) {
      document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-in'));
    }
  }
}

boot().catch((e) => console.warn(`[site] boot: ${describe(e)}`));
