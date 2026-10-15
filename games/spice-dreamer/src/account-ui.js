// The account panel: sign in (email code, Google, Discord), pick a handle + initials, sign out.
// It's plain HTML over the canvas, because typing an email or a name doesn't fit a wheel-and-space game.
// openAccountPanel() resolves with the signed-in account (or null) when the panel closes.

import { getConfig, getAccount, sendCode, verifyCode, signInWith, saveProfile, signOut } from './arcade.js';

const CSS = `
.arc-wrap { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center; padding: 16px;
  background: rgba(16, 6, 30, .72); font: 600 15px/1.4 ui-monospace, Menlo, Consolas, monospace; color: #fff3dd; }
.arc-panel { width: min(400px, 100%); background: #1e0b3a; border: 3px solid #ffd34a; box-shadow: 6px 6px 0 #5a1a2a;
  padding: 20px; display: grid; gap: 12px; }
.arc-panel h2 { margin: 0; color: #ffd34a; font-size: 20px; letter-spacing: 1px; text-transform: uppercase; }
.arc-panel p { margin: 0; color: #ffd98a; }
.arc-panel label { display: grid; gap: 4px; font-size: 13px; color: #ffb45e; text-transform: uppercase; }
.arc-panel input { font: inherit; font-size: 17px; padding: 8px 10px; background: #12061f; color: #fff;
  border: 2px solid #9c2462; outline: none; }
.arc-panel input:focus { border-color: #ffd34a; }
.arc-panel button { font: inherit; text-transform: uppercase; letter-spacing: 1px; padding: 10px 12px; cursor: pointer;
  background: #ffd34a; color: #1e0b3a; border: 0; box-shadow: 3px 3px 0 #5a1a2a; }
.arc-panel button:hover { background: #fff0a0; }
.arc-panel button:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 #5a1a2a; }
.arc-panel button:disabled { opacity: .6; cursor: wait; }
.arc-panel button.arc-alt { background: transparent; color: #ffd98a; box-shadow: none; border: 2px solid #651a66; }
.arc-panel button.arc-alt:hover { border-color: #ffd34a; }
.arc-panel .arc-row { display: flex; gap: 8px; }
.arc-panel .arc-row > * { flex: 1; }
.arc-panel .arc-or { text-align: center; font-size: 12px; color: #9c8a70; text-transform: uppercase; }
.arc-panel .arc-err { color: #ff6a5a; min-height: 1.4em; }
.arc-panel .arc-small { font-size: 12px; color: #c89464; }
.arc-panel a { color: #ffd34a; }
.arc-panel a:hover { color: #fff0a0; }
.arc-panel .arc-credit { display: grid; gap: 2px; padding-left: 10px; border-left: 3px solid #9c2462; }
.arc-panel .arc-credit h3 { margin: 0; font-size: 12px; color: #ffb45e; text-transform: uppercase; letter-spacing: 1px; }
`;

function addStyles()
{
  if (!document.getElementById('arc-css'))
    document.head.append(Object.assign(document.createElement('style'), { id: 'arc-css', textContent: CSS }));
}

// a simple panel of HTML with a close button (used for credits). Resolves when it closes.
export function openInfoPanel(html)
{
  addStyles();
  const wrap = document.createElement('div');
  wrap.className = 'arc-wrap';
  wrap.innerHTML = `<div class="arc-panel">${html}<button data-close>Close</button></div>`;
  document.body.append(wrap);
  return new Promise(resolve =>
  {
    const close = () => { wrap.remove(); resolve(); };
    for (const type of ['keydown', 'wheel', 'mousedown', 'pointerdown'])
      wrap.addEventListener(type, e => { e.stopPropagation(); if (type == 'keydown' && (e.key == 'Escape' || e.key == ' ')) { e.preventDefault(); close(); } });
    wrap.addEventListener('click', e => { if (e.target == wrap) close(); });
    wrap.querySelector('[data-close]').onclick = close;
    wrap.querySelector('[data-close]').focus();
  });
}

let open = null;

export const accountPanelOpen = () => !!open;

export function openAccountPanel({ reason='' }={})
{
  if (open) return open.promise;
  addStyles();

  const wrap = document.createElement('div');
  wrap.className = 'arc-wrap';
  const panel = document.createElement('div');
  panel.className = 'arc-panel';
  wrap.append(panel);
  document.body.append(wrap);

  // keep typing and clicking in the panel away from the game underneath. Releases still go through,
  // so a key or button held when the panel opened (like the Space that opened it) doesn't stay stuck down.
  for (const type of ['keydown', 'wheel', 'mousedown', 'pointerdown'])
    wrap.addEventListener(type, e => { e.stopPropagation(); if (type == 'keydown' && e.key == 'Escape') close(); });
  wrap.addEventListener('click', e => { if (e.target == wrap) close(); });

  let resolve;
  open = { promise: new Promise(r => resolve = r) };
  let email = '';

  async function close()
  {
    wrap.remove();
    open = null;
    resolve(await getAccount());
  }

  function render(html, setup)
  {
    panel.innerHTML = html;
    const err = panel.querySelector('.arc-err');
    const fail = e => { if (err) err.textContent = e.message || String(e); };
    const busy = (button, fn) => async (...args) =>
    {
      button.disabled = true;
      if (err) err.textContent = '';
      try { await fn(...args); } catch (e) { fail(e); } finally { button.disabled = false; }
    };
    setup?.({ $: s => panel.querySelector(s), busy, fail });
    panel.querySelector('input')?.focus();
  }

  async function signInScreen()
  {
    const { providers } = await getConfig();
    const social = providers.filter(p => p != 'email');
    render(`
      <h2>Sign in</h2>
      ${reason ? `<p>${reason}</p>` : '<p>Sign in to post scores to the boards.</p>'}
      ${social.map(p => `<button data-provider="${p}">Continue with ${p == 'google' ? 'Google' : 'Discord'}</button>`).join('')}
      ${social.length ? '<div class="arc-or">or with email</div>' : ''}
      <form class="arc-email" style="display:grid;gap:12px">
        <label>Email <input type="email" required autocomplete="email" placeholder="you@example.com"></label>
        <button type="submit">Email me a code</button>
      </form>
      <div class="arc-err"></div>
      <button class="arc-alt" data-close>Not now</button>`,
    ({ $, busy }) =>
    {
      for (const b of panel.querySelectorAll('[data-provider]'))
        b.onclick = busy(b, async () => { const acc = await signInWith(b.dataset.provider); afterSignIn(acc); });
      const form = $('.arc-email'), button = form.querySelector('button');
      form.onsubmit = e =>
      {
        e.preventDefault();
        busy(button, async () => { email = form.querySelector('input').value.trim(); await sendCode(email); codeScreen(); })();
      };
      $('[data-close]').onclick = close;
    });
  }

  function codeScreen()
  {
    render(`
      <h2>Check your email</h2>
      <p>We sent a 6-digit code to <b>${email.replace(/</g, '&lt;')}</b>.</p>
      <form style="display:grid;gap:12px">
        <label>Code <input inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required></label>
        <button type="submit">Sign in</button>
      </form>
      <div class="arc-err"></div>
      <div class="arc-row"><button class="arc-alt" data-back>Different email</button><button class="arc-alt" data-resend>Resend code</button></div>`,
    ({ $, busy }) =>
    {
      const form = $('form'), button = form.querySelector('button');
      form.onsubmit = e =>
      {
        e.preventDefault();
        busy(button, async () => afterSignIn(await verifyCode(email, form.querySelector('input').value.trim())))();
      };
      $('[data-back]').onclick = signInScreen;
      $('[data-resend]').onclick = busy($('[data-resend]'), () => sendCode(email));
    });
  }

  function afterSignIn(acc)
  {
    if (!acc) throw new Error('sign-in did not finish, try again');
    acc.profile ? close() : profileScreen(acc);
  }

  function profileScreen(acc)
  {
    const p = acc.profile || {};
    render(`
      <h2>${acc.profile ? 'Edit your name' : 'Pick your name'}</h2>
      <p>Your handle is how you show up on the boards and in share links. Initials are your arcade tag in the game.</p>
      <form style="display:grid;gap:12px">
        <label>Handle <input name="handle" required minlength="3" maxlength="16" pattern="[A-Za-z0-9_\\-]{3,16}"
          autocomplete="nickname" value="${p.handle || ''}" placeholder="3-16 letters, numbers, _ or -"></label>
        <label>Initials <input name="initials" required minlength="3" maxlength="3" pattern="[A-Za-z]{3}"
          value="${p.initials || ''}" placeholder="ABC" style="text-transform:uppercase;letter-spacing:6px;width:7em"></label>
        <button type="submit">Save</button>
      </form>
      <div class="arc-err"></div>
      ${acc.profile ? '<button class="arc-alt" data-back>Back</button>' : '<button class="arc-alt" data-out>Sign out</button>'}`,
    ({ $, busy }) =>
    {
      const form = $('form'), button = form.querySelector('button');
      const handle = form.handle, initials = form.initials;
      // suggest initials from the handle until the player types their own
      let touched = !!p.initials;
      initials.oninput = () => { touched = true; initials.value = initials.value.replace(/[^a-z]/gi, '').toUpperCase(); };
      handle.oninput = () => { if (!touched) initials.value = handle.value.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase(); };
      form.onsubmit = e =>
      {
        e.preventDefault();
        busy(button, async () => { await saveProfile(handle.value.trim(), initials.value.trim()); close(); })();
      };
      if ($('[data-back]')) $('[data-back]').onclick = () => accountScreen(acc);
      if ($('[data-out]')) $('[data-out]').onclick = async () => { await signOut(); close(); };
    });
  }

  function accountScreen(acc)
  {
    render(`
      <h2>${acc.profile.handle} <span style="color:#ff7a1c">${acc.profile.initials}</span></h2>
      <p class="arc-small">Signed in as ${(acc.user.email || '').replace(/</g, '&lt;')}</p>
      <button data-edit>Edit name</button>
      <div class="arc-row"><button class="arc-alt" data-out>Sign out</button><button class="arc-alt" data-close>Close</button></div>
      <div class="arc-err"></div>`,
    ({ $ }) =>
    {
      $('[data-edit]').onclick = () => profileScreen(acc);
      $('[data-out]').onclick = async () => { await signOut(); close(); };
      $('[data-close]').onclick = close;
    });
  }

  getAccount().then(acc => !acc ? signInScreen() : !acc.profile ? profileScreen(acc) : accountScreen(acc));
  return open.promise;
}
