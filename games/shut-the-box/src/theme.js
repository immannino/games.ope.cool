// Shared look for every HTML panel: walnut frames, green felt wells, maple buttons, brass trim.
// The wood and felt are the same generated textures the game board uses, handed to CSS as data URLs.
import { woodDataUrl, makeFelt } from './textures.js';

export function installTheme()
{
  if (document.getElementById('stb-theme')) return;
  const walnut = woodDataUrl('walnut', 720, 480);
  const maple = woodDataUrl('maple', 480, 160);
  const felt = makeFelt(256, 256).toDataURL('image/jpeg', .8);
  document.head.append(Object.assign(document.createElement('style'), {
    id: 'stb-theme',
    textContent: `:root { --walnut: url(${walnut}); --maple: url(${maple}); --felt: url(${felt}); }\n` + CSS,
  }));
}

const CSS = `
:root {
  --ink: #2b1709; --ink-soft: #5a3a1c; --cream: #f3e9cc; --cream-dim: #cdbf9a;
  --brass: #d7b05a; --brass-dark: #8f6a22; --felt-dark: #123d27;
  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
}
/* the dimmed table behind a panel */
.arc-wrap, .stb-wrap { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center; padding: 14px;
  background: radial-gradient(ellipse at center, rgba(12,7,3,.45), rgba(8,4,2,.8)); overflow: auto;
  font: 500 16px/1.45 var(--serif); color: var(--cream); animation: stb-fade .22s ease-out; }
@keyframes stb-fade { from { opacity: 0 } }
@keyframes stb-rise { from { opacity: 0; transform: translateY(14px) scale(.98) } }

/* a walnut panel: frame, grain, a thin inlay line, and a felt well inside */
.arc-panel, .stb-panel { position: relative; width: min(440px, 100%); padding: 22px; border-radius: 16px; display: grid; gap: 14px;
  background: linear-gradient(rgba(0,0,0,.06), rgba(0,0,0,.28)), var(--walnut) center/cover, #4a2a14;
  border: 1px solid #120905;
  box-shadow: inset 0 1px 0 rgba(255,225,180,.22), inset 0 -2px 0 rgba(0,0,0,.35), inset 0 0 0 7px rgba(0,0,0,.0),
    0 28px 60px rgba(0,0,0,.6), 0 4px 10px rgba(0,0,0,.5); animation: stb-rise .28s cubic-bezier(.2,.8,.3,1); }
.arc-panel::before, .stb-panel::before { content: ''; position: absolute; inset: 7px; border-radius: 11px; pointer-events: none;
  border: 1px solid rgba(235,200,140,.28); box-shadow: 0 0 0 1px rgba(0,0,0,.35); }
.stb-panel.wide { width: min(560px, 100%); }
.arc-panel > *, .stb-panel > * { position: relative; }
.arc-panel h2, .stb-panel h2 { margin: 0; font: 600 24px/1.15 var(--serif); letter-spacing: .12em; text-transform: uppercase; text-align: center;
  color: var(--cream); text-shadow: 0 -1px 0 rgba(0,0,0,.6), 0 1px 0 rgba(255,225,170,.18); }
.stb-panel h1 { margin: 0; text-align: center; font: 700 clamp(30px, 8vw, 46px)/1.02 var(--serif); letter-spacing: .1em; text-transform: uppercase;
  color: #f6e9c2; text-shadow: 0 -1px 0 rgba(0,0,0,.7), 0 2px 0 rgba(255,225,170,.16), 0 8px 18px rgba(0,0,0,.45); }
.stb-sub { margin: 0; text-align: center; font-style: italic; color: var(--cream-dim); text-shadow: 0 1px 0 rgba(0,0,0,.5); }
.arc-panel p { margin: 0; color: var(--cream-dim); text-shadow: 0 1px 0 rgba(0,0,0,.5); }

/* the felt well */
.stb-felt { padding: 14px 16px; border-radius: 10px; color: var(--cream);
  background: radial-gradient(ellipse at 50% 30%, rgba(255,255,255,.07), rgba(0,0,0,.28)), var(--felt) center/256px, #1f5a3b;
  box-shadow: inset 0 3px 10px rgba(0,0,0,.65), inset 0 0 0 1px rgba(0,0,0,.4), 0 1px 0 rgba(255,225,180,.2); }
.stb-felt h3 { margin: 0 0 6px; font: 600 12px/1 var(--serif); letter-spacing: .22em; text-transform: uppercase; color: var(--brass); }
.stb-felt p, .stb-felt li { margin: 0; color: #e7ddbd; }
.stb-felt ol, .stb-felt ul { margin: 0; padding-left: 1.2em; display: grid; gap: 6px; }

/* maple buttons: a lacquered wooden key with a dark lip */
.arc-panel button, .stb-btn, .stb-knob { font: 700 14px/1 var(--serif); letter-spacing: .14em; text-transform: uppercase; cursor: pointer; color: var(--ink);
  padding: 13px 14px; border-radius: 9px; border: 1px solid #4b2c10;
  background: linear-gradient(rgba(255,255,255,.28), rgba(255,255,255,0) 45%, rgba(60,25,0,.22)), var(--maple) center/cover, #d9b072;
  text-shadow: 0 1px 0 rgba(255,240,205,.55);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.65), inset 0 -2px 0 rgba(90,45,10,.35), 0 3px 0 #3a2008, 0 7px 12px rgba(0,0,0,.45);
  transition: transform .06s, box-shadow .06s, filter .15s; }
.arc-panel button:hover, .stb-btn:hover, .stb-knob:hover { filter: brightness(1.07) saturate(1.05); }
.arc-panel button:active, .stb-btn:active, .stb-knob:active { transform: translateY(3px);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.55), inset 0 -1px 0 rgba(90,45,10,.35), 0 0 0 #3a2008, 0 2px 4px rgba(0,0,0,.5); }
.arc-panel button:disabled, .stb-btn:disabled { opacity: .55; cursor: wait; }
.arc-panel button:focus-visible, .stb-btn:focus-visible, .stb-knob:focus-visible, .arc-panel input:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; }
/* the primary button is brass */
.stb-btn.primary { color: #2a1b04; border-color: #5a3d0b; text-shadow: 0 1px 0 rgba(255,244,200,.6);
  background: linear-gradient(rgba(255,255,255,.4), rgba(255,255,255,0) 50%, rgba(80,50,0,.25)), linear-gradient(#ecd081, #c79a3a);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.7), inset 0 -2px 0 rgba(110,70,0,.4), 0 3px 0 #4a3008, 0 7px 12px rgba(0,0,0,.45); }
/* secondary buttons sit back into the walnut */
.arc-panel button.arc-alt, .stb-btn.quiet { color: var(--cream); text-shadow: 0 -1px 0 rgba(0,0,0,.6);
  background: linear-gradient(rgba(255,235,200,.12), rgba(0,0,0,.18)), var(--walnut) center/cover, #4a2a14; border-color: #120905;
  box-shadow: inset 0 1px 0 rgba(255,225,180,.28), inset 0 -2px 0 rgba(0,0,0,.35), 0 3px 0 #0e0703, 0 7px 12px rgba(0,0,0,.4); }
.stb-stack { display: grid; gap: 10px; }
.stb-row { display: flex; gap: 10px; } .stb-row > * { flex: 1; }

/* inputs are recessed felt-lined slots */
.arc-panel input { font: 600 17px var(--serif); padding: 10px 12px; border-radius: 7px; color: var(--cream); background: #102e1f;
  border: 1px solid #07150d; box-shadow: inset 0 3px 7px rgba(0,0,0,.6), 0 1px 0 rgba(255,225,180,.25); outline: none; }
.arc-panel label { display: grid; gap: 5px; font: 600 11px var(--serif); letter-spacing: .2em; text-transform: uppercase; color: var(--brass); }
.arc-panel .arc-row { display: flex; gap: 10px; } .arc-panel .arc-row > * { flex: 1; }
.arc-panel .arc-or { text-align: center; font-size: 11px; letter-spacing: .2em; color: var(--cream-dim); text-transform: uppercase; }
.arc-panel .arc-err { color: #ffb08a; min-height: 1.4em; font-size: 14px; }
.arc-panel .arc-small { font-size: 13px; }
.arc-panel a, .stb-panel a { color: var(--brass); }
.arc-panel h2 span { color: var(--brass); }

/* scores */
.stb-big { font: 700 clamp(44px, 12vw, 64px)/1 var(--serif); text-align: center; color: #f6e9c2; font-variant-numeric: lining-nums tabular-nums;
  text-shadow: 0 -1px 0 rgba(0,0,0,.6), 0 2px 0 rgba(255,225,170,.15), 0 6px 14px rgba(0,0,0,.45); }
.stb-big small { display: block; margin-top: 8px; font: 600 11px/1 var(--serif); letter-spacing: .24em; text-transform: uppercase; color: var(--brass); text-shadow: none; }
.stb-table { width: 100%; border-collapse: collapse; font-variant-numeric: lining-nums tabular-nums; }
.stb-table th { font: 600 11px var(--serif); letter-spacing: .18em; text-transform: uppercase; color: var(--brass); text-align: right; padding: 0 0 6px; }
.stb-table th:first-child, .stb-table td:first-child { text-align: left; }
.stb-table td { text-align: right; padding: 5px 0; border-top: 1px solid rgba(255,235,190,.12); color: #efe5c6; }
.stb-table tr.me td { color: #ffe9a6; font-weight: 700; }
.stb-table td.rank { color: var(--cream-dim); width: 2.2em; }
.stb-tabs { display: flex; gap: 6px; justify-content: center; }
.stb-tabs button { flex: 1; padding: 9px 6px; font-size: 12px; }
.stb-tabs button[aria-pressed="true"] { filter: none; transform: translateY(2px); color: #2a1b04;
  background: linear-gradient(rgba(255,255,255,.4), rgba(255,255,255,0) 50%, rgba(80,50,0,.25)), linear-gradient(#ecd081, #c79a3a);
  box-shadow: inset 0 2px 3px rgba(80,50,0,.4), 0 1px 0 #4a3008; }
.stb-note { font-size: 14px; color: var(--cream-dim); text-align: center; text-shadow: 0 1px 0 rgba(0,0,0,.5); }
.stb-good { color: #ffe9a6; }

/* the round knobs on the table (menu, sound, boards) */
.stb-knob { position: fixed; z-index: 5; width: 42px; height: 42px; padding: 0; display: grid; place-items: center; border-radius: 50%;
  font-size: 19px; letter-spacing: 0; box-shadow: inset 0 1px 0 rgba(255,255,255,.65), inset 0 -2px 0 rgba(90,45,10,.35), 0 2px 0 #3a2008, 0 6px 10px rgba(0,0,0,.5); }
.stb-knob svg { width: 20px; height: 20px; fill: none; stroke: var(--ink); stroke-width: 2.1; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 1px 0 rgba(255,240,205,.6)); }
@media (prefers-reduced-motion: reduce) { .arc-panel, .stb-panel, .arc-wrap, .stb-wrap { animation: none; } }
`;
