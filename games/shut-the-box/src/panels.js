// The HTML panels over the table: title, rules, round and match results, menu.
// They're plain DOM because they're mostly words, and the theme (theme.js) dresses them in the same
// walnut, felt and brass as the board.

import { installTheme } from './theme.js';
import { ROUNDS, MATCH_MAX } from './sim.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let current = null;
export const panelOpen = () => !!current;

// Opens one panel, replacing any that's showing. setup(root, close) wires its buttons.
function open(html, { wide=false, dismiss=null, setup }={})
{
  installTheme();
  closePanel();
  const wrap = document.createElement('div');
  wrap.className = 'stb-wrap';
  wrap.innerHTML = `<div class="stb-panel${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.append(wrap);
  // the game underneath doesn't hear keys or pointers aimed at the panel
  for (const type of ['keydown', 'pointerdown', 'wheel'])
    wrap.addEventListener(type, e =>
    {
      e.stopPropagation();
      if (type === 'keydown' && e.key === 'Escape' && dismiss) { e.preventDefault(); close(); dismiss(); }
    });
  const close = () => { if (current?.wrap === wrap) closePanel(); };
  current = { wrap };
  setup?.(wrap, close);
  (wrap.querySelector('[data-focus]') || wrap.querySelector('button'))?.focus({ preventScroll: true });
  return wrap;
}

export function closePanel()
{
  current?.wrap.remove();
  current = null;
}

const on = (root, sel, fn) => root.querySelector(sel)?.addEventListener('click', fn);

///////////////////////////////////////////////////////////////////////////////

const toggleLabel = (name, on) => `${name}: ${on ? 'on' : 'off'}`;

export function titlePanel({ best, hints, shake, onPlay, onHow, onHints, onShake })
{
  return open(`
    <div style="display:grid;gap:6px">
      <h1>Shut<br>the Box</h1>
      <p class="stb-sub">A game of dice, tiles and nerve</p>
    </div>
    <div class="stb-stack">
      <button class="stb-btn primary" data-focus data-act="play">Play</button>
      <button class="stb-btn quiet" data-act="how">How to play</button>
      <div class="stb-row">
        <button class="stb-btn quiet" data-act="hints" aria-pressed="${hints}">${toggleLabel('Hints', hints)}</button>
        ${shake != null ? `<button class="stb-btn quiet" data-act="shake" aria-pressed="${shake}">${toggleLabel('Shake', shake)}</button>` : ''}
      </div>
    </div>
    ${best != null ? `<div class="stb-felt" style="text-align:center"><p style="font-size:14px">Your best match <b class="stb-good">${best}</b> of ${MATCH_MAX}</p></div>` : ''}`,
  {
    setup: root =>
    {
      on(root, '[data-act=play]', onPlay); on(root, '[data-act=how]', onHow);
      for (const [act, fn, name] of [['hints', onHints, 'Hints'], ['shake', onShake, 'Shake']])
        root.querySelector(`[data-act=${act}]`)?.addEventListener('click', async e =>
        {
          const on = await fn();
          e.currentTarget.textContent = toggleLabel(name, on);
        });
    },
  });
}

export function howToPanel({ onClose, touch })
{
  return open(`
    <h2>How to play</h2>
    <div class="stb-felt"><ol>
      <li><b>Roll</b> the dice: tap Roll, or ${touch ? 'shake your phone' : 'pick them up, swish and flick them'}.</li>
      <li><b>Shut tiles</b> that add up to the roll. With a 7 you could shut the 7, or the 3 and 4, or the 1, 2 and 4. Tap tiles, or flick them up. They fall shut as soon as they match.</li>
      <li>Roll again. Shut tiles stay shut.</li>
      <li>When no open tiles can make your roll, the round ends. The tiles still open are your pips left.</li>
      <li>Once the 7, 8 and 9 are all shut you roll a single die.</li>
    </ol></div>
    <div class="stb-felt"><h3>Scoring</h3><p>A round scores <b>45 minus the pips left</b>. Shut every tile and it's <b>${45 + 25}</b>. A match is ${ROUNDS} rounds, so ${MATCH_MAX} is perfect.</p></div>
    <p class="stb-note">Keys: <b>Space</b> rolls · <b>1–9</b> pick tiles · <b>H</b> hints · <b>Esc</b> menu</p>
    <button class="stb-btn primary" data-focus data-act="close">Got it</button>`,
  { dismiss: onClose, setup: root => on(root, '[data-act=close]', onClose) });
}

export function roundPanel({ round, result, score, last, onNext })
{
  const shut = result.shut;
  return open(`
    <h2>${shut ? 'Box shut!' : 'No move fits'}</h2>
    <div class="stb-felt">
      <div class="stb-big">${result.points}<small>${shut ? 'shut the box, bonus included' : `${result.left} pip${result.left == 1 ? '' : 's'} left`}</small></div>
    </div>
    <p class="stb-note">Round ${round + 1} of ${ROUNDS} · match score ${score}</p>
    <button class="stb-btn primary" data-focus data-act="next">${last ? 'See results' : 'Next round'}</button>`,
  { setup: root => on(root, '[data-act=next]', onNext) });
}

export function resultsPanel({ rounds, score, best, newBest, onAgain, onMenu })
{
  return open(`
    <h2>Match complete</h2>
    <div class="stb-felt">
      <div class="stb-big">${score}<small>of ${MATCH_MAX}${newBest ? ' · <span class="stb-good">new best</span>' : best != null ? ` · best ${best}` : ''}</small></div>
      <table class="stb-table" style="margin-top:12px"><thead><tr><th>Round</th><th>Pips left</th><th>Points</th></tr></thead><tbody>
        ${rounds.map((r, i) => `<tr><td>${i + 1}</td><td>${r.shut ? 'box shut' : r.left}</td><td>${r.points}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <div class="stb-stack">
      <button class="stb-btn primary" data-focus data-act="again">Play again</button>
      <button class="stb-btn quiet" data-act="menu">Menu</button>
    </div>`,
  { setup: r => { on(r, '[data-act=again]', onAgain); on(r, '[data-act=menu]', onMenu); } });
}

export function menuPanel({ hints, shake, onResume, onRestart, onHow, onHints, onShake, onQuit })
{
  return open(`
    <h2>Paused</h2>
    <div class="stb-stack">
      <button class="stb-btn primary" data-focus data-act="resume">Back to the game</button>
      <button class="stb-btn" data-act="restart">Restart match</button>
      <div class="stb-row">
        <button class="stb-btn quiet" data-act="hints">${toggleLabel('Hints', hints)}</button>
        ${shake != null ? `<button class="stb-btn quiet" data-act="shake">${toggleLabel('Shake', shake)}</button>` : ''}
      </div>
      <button class="stb-btn quiet" data-act="how">How to play</button>
      <button class="stb-btn quiet" data-act="quit">Quit to title</button>
    </div>`,
  {
    dismiss: onResume,
    setup: root =>
    {
      on(root, '[data-act=resume]', onResume); on(root, '[data-act=restart]', onRestart); on(root, '[data-act=how]', onHow); on(root, '[data-act=quit]', onQuit);
      for (const [act, fn, name] of [['hints', onHints, 'Hints'], ['shake', onShake, 'Shake']])
        root.querySelector(`[data-act=${act}]`)?.addEventListener('click', async e => { e.currentTarget.textContent = toggleLabel(name, await fn()); });
    },
  });
}
