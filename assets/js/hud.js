// Film HUD overlay. Fills the four readouts and writes to the DOM only when a
// value actually changes.
//
//   #hud-beats    one square per section, filled up to the current one
//   #hud-section  03/09 · RESEARCH
//   #hud-tc       F0341 · 00:00:05:41   (frame = round(scrollY / 3), 60 fps)
//   #hud-shape    SHAPE TORUS · ROT 212.4° · N 1400   (from dots:readout)
//                 SHAPE FLOOR · ROT 012.0° · N 3093   (the floor: camera pitch)
//                 (a readout with a mode instead reads SHAPE X · MODE · −25% DOTS)
//
// Each readout is rebuilt as key/value spans (.hud-k = dim label, .hud-v =
// value) whose combined text is exactly the strings above.

const FPS = 60;
const PX_PER_FRAME = 3;
const COLLIDE_GAP = 14;

const BASE_CSS = `
:where(#hud-beats){display:inline-flex;gap:3px;align-items:center;vertical-align:middle;margin-right:.9em}
:where(#hud-beats) > :where(.beat){display:block;width:6px;height:6px;box-sizing:border-box;border:1px solid currentColor;opacity:.4}
:where(#hud-beats) > :where(.beat.is-on){background:currentColor;opacity:.75}
:where(#hud-beats) > :where(.beat.is-cur){opacity:1}
:where(.hud) :where(.hud-k){opacity:.55}
`;

const els = {};
const fields = {};
let beats = { count: -1, index: -1 };
let tcFrame = 0;
let fitFrame = 0;
let shapeMode = 'full';
let shapeLenKey = '';
let tcLen = 0;

const pad = (n, w = 2) => String(n).padStart(w, '0');

function injectBaseStyles() {
  if (document.getElementById('hud-base-css')) return;
  const style = document.createElement('style');
  style.id = 'hud-base-css';
  style.textContent = BASE_CSS;
  document.head.prepend(style); // first, so site CSS wins on equal specificity
}

// A field is a fixed row of spans; set() only touches parts whose text changed.
function makeField(el, kinds) {
  if (!el) return null;
  el.textContent = '';
  const parts = kinds.map((kind) => {
    const span = document.createElement('span');
    span.className = kind === 'k' ? 'hud-k' : 'hud-v';
    el.appendChild(span);
    return { span, text: '' };
  });
  return {
    el,
    parts,
    set(values) {
      for (let i = 0; i < parts.length; i++) {
        const text = values[i] == null ? '' : String(values[i]);
        if (parts[i].text !== text) {
          parts[i].text = text;
          parts[i].span.textContent = text;
        }
      }
    },
  };
}

// ---------------------------------------------------------------- section + beats

function renderBeats(index, count) {
  const host = els.beats;
  if (!host || count < 1) return;
  if (beats.count !== count) {
    host.textContent = '';
    for (let i = 0; i < count; i++) {
      const b = document.createElement('span');
      b.className = 'beat';
      host.appendChild(b);
    }
    beats = { count, index: -1 };
  }
  if (beats.index === index) return;
  const nodes = host.children;
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].classList.toggle('is-on', i <= index);
    nodes[i].classList.toggle('is-cur', i === index);
  }
  beats.index = index;
}

function renderSection(index, count, label) {
  if (fields.section) {
    fields.section.set([`${pad(index + 1)}/${pad(count)}`, ' · ', String(label || '').toUpperCase()]);
  }
  renderBeats(index, count);
}

function onSceneChange(e) {
  const d = e.detail || {};
  if (typeof d.index !== 'number') return;
  renderSection(d.index, d.count || 1, d.label || (d.el && d.el.dataset.label) || '');
}

// Until scenes.js speaks (or if it never loads), derive the section from the DOM.
function renderSectionFromDom() {
  const sections = document.querySelectorAll('section.scene');
  if (!sections.length) return;
  const line = window.innerHeight / 2;
  let idx = 0;
  sections.forEach((s, i) => {
    if (s.getBoundingClientRect().top <= line) idx = i;
  });
  renderSection(idx, sections.length, sections[idx].dataset.label || sections[idx].id);
}

// ---------------------------------------------------------------- timecode

function renderTc() {
  tcFrame = 0;
  if (!fields.tc) return;
  const f = Math.round(Math.max(0, window.scrollY) / PX_PER_FRAME);
  const sec = Math.floor(f / FPS);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const frameText = `F${pad(f, 4)}`;
  fields.tc.set([frameText, ' · ', `${pad(hr)}:${pad(min % 60)}:${pad(sec % 60)}:${pad(f % FPS)}`]);
  if (frameText.length !== tcLen) {
    tcLen = frameText.length;
    scheduleFit();
  }
}

function scheduleTc() {
  if (!tcFrame) tcFrame = requestAnimationFrame(renderTc);
}

// ---------------------------------------------------------------- shape readout

const latest = { name: 'FLOOR', label: 'ROT', rot: '012.0°', count: '', mode: '', saved: '' };

// Short mode (a narrow bar) drops the last pair.
function writeShape() {
  const full = shapeMode === 'full';
  if (latest.mode) {
    fields.shape.set(['SHAPE ', latest.name, ' · ', latest.mode,
      full ? ' · ' : '', full ? latest.saved : '', full ? ' DOTS' : '']);
    return;
  }
  const withCount = full && latest.count !== '';
  fields.shape.set(['SHAPE ', latest.name, ` · ${latest.label} `, latest.rot,
    withCount ? ' · N ' : '', withCount ? latest.count : '', '']);
}

function onReadout(e) {
  if (!fields.shape) return;
  const d = e.detail || {};
  let rot = Number(d.rot);
  rot = Number.isFinite(rot) ? ((rot % 360) + 360) % 360 : 0;
  const count = d.count == null || d.count === '' ? NaN : Number(d.count);
  latest.name = String(d.shape || '').toUpperCase();
  latest.label = String(d.rotLabel || 'ROT').toUpperCase();
  latest.rot = `${rot.toFixed(1).padStart(5, '0')}°`;
  latest.count = Number.isFinite(count) ? pad(Math.max(0, Math.round(count)), 4) : '';
  latest.mode = String(d.mode || '').toUpperCase();
  latest.saved = `\u2212${Math.max(0, Math.round(Number(d.saved) || 0))}%`;

  // Width only changes with the name, label, mode or the count's digit count.
  const key = `${latest.name.length}:${latest.label.length}:${latest.mode}:${latest.count.length}:${latest.saved.length}`;
  if (key !== shapeLenKey) {
    shapeLenKey = key;
    scheduleFit();
  }
  if (shapeMode !== 'hidden') writeShape();
}

// On narrow screens the bottom-left shape readout can run into the timecode
// on the right. Try the full text, then without the particle count, then hide.
function collides() {
  const a = els.shape.getBoundingClientRect();
  const b = els.tc ? els.tc.getBoundingClientRect() : null;
  if (!a.width) return false;
  if (a.right > window.innerWidth - 4 || a.left < 0) return true;
  if (!b || !b.width) return false;
  const overlapX = a.left < b.right + COLLIDE_GAP && a.right + COLLIDE_GAP > b.left;
  const overlapY = a.top < b.bottom && a.bottom > b.top;
  return overlapX && overlapY;
}

function setShapeMode(mode) {
  shapeMode = mode;
  writeShape();
  els.shape.style.visibility = mode === 'hidden' ? 'hidden' : '';
}

function fit() {
  fitFrame = 0;
  if (!fields.shape) return;
  setShapeMode('full');
  if (!collides()) return;
  setShapeMode('short');
  if (!collides()) return;
  setShapeMode('hidden');
}

function scheduleFit() {
  if (!fitFrame) fitFrame = requestAnimationFrame(fit);
}

// ---------------------------------------------------------------- init

export function init() {
  els.beats = document.getElementById('hud-beats');
  els.section = document.getElementById('hud-section');
  els.tc = document.getElementById('hud-tc');
  els.shape = document.getElementById('hud-shape');
  if (!els.beats && !els.section && !els.tc && !els.shape) return;

  injectBaseStyles();
  fields.section = makeField(els.section, ['k', 'k', 'v']);
  fields.tc = makeField(els.tc, ['k', 'k', 'v']);

  if (els.shape) {
    // Keep the static placeholder (e.g. SHAPE FLOOR · ROT 012.0°) until the
    // first readout arrives, but in the same key/value structure.
    const m = /SHAPE\s+(\S+).*?(ROT|GAZE)\s+([\d.]+)/i.exec(els.shape.textContent || '');
    fields.shape = makeField(els.shape, ['k', 'v', 'k', 'v', 'k', 'v', 'k']);
    if (m) {
      latest.name = m[1].toUpperCase();
      latest.label = m[2].toUpperCase();
      latest.rot = `${m[3]}°`;
    }
    writeShape();
  }

  renderSectionFromDom();
  renderTc();
  scheduleFit();

  window.addEventListener('scene:change', onSceneChange);
  window.addEventListener('dots:readout', onReadout);
  window.addEventListener('scroll', scheduleTc, { passive: true });
  window.addEventListener('resize', () => {
    scheduleTc();
    scheduleFit();
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleFit).catch(() => {});
  }
}
