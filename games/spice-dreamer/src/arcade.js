// Client for the ope.cool arcade API (api/ in this repo): sign-in, profile, posting runs and leaderboards.
// The API lives on another site, so the session is a bearer token kept in localStorage, not a cookie.

import { createAuthClient } from 'better-auth/client';
import { emailOTPClient, oauthPopupClient, getStoredPopupToken } from 'better-auth/client/plugins';

export const API_URL = import.meta.env.VITE_ARCADE_API
  || (import.meta.env.DEV ? 'http://localhost:8787' : 'https://ope-arcade-api.anthonyjosephmannino.workers.dev');
export const GAME = 'spice-dreamer';

const TOKEN_KEY = 'opearcade.token';
const store = {
  get() { try { return localStorage.getItem(TOKEN_KEY) || getStoredPopupToken(); } catch { return null; } },
  set(token) { try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch {} },
};

export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: '/api/auth',
  plugins: [emailOTPClient(), oauthPopupClient()],
  fetchOptions: {
    credentials: 'omit', // the session is the bearer token, never a cookie
    auth: { type: 'Bearer', token: () => store.get() || '' },
    onSuccess(ctx)
    {
      const token = ctx.response.headers.get('set-auth-token');
      if (token) store.set(token);
    },
  },
});

async function api(method, path, body)
{
  const token = store.get();
  const res = await fetch(API_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `request failed (${res.status})`), { status: res.status });
  return data;
}

// the signed-in player, or null. Cached; pass refresh to ask the server again.
let account;
export async function getAccount(refresh=false)
{
  if (account !== undefined && !refresh) return account;
  if (!store.get()) return account = null;
  try
  {
    const { user, profile } = await api('GET', '/api/me');
    account = { user, profile };
  }
  catch (e)
  {
    if (e.status == 401) store.set(null); // expired or revoked
    account = e.status == 401 ? null : account ?? null;
  }
  return account;
}
export const cachedAccount = () => account ?? null;

let config;
export async function getConfig()
{
  return config ??= await api('GET', '/api/config').catch(() => ({ providers: ['email'] }));
}

export async function sendCode(email)
{
  const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' });
  if (error) throw new Error(error.message || 'could not send a code');
}

export async function verifyCode(email, otp)
{
  const { error } = await authClient.signIn.emailOtp({ email, otp });
  if (error) throw new Error(error.message || 'that code did not work');
  return getAccount(true);
}

export async function signInWith(provider)
{
  const { error } = await authClient.signIn.popup({ provider });
  if (error) throw new Error(error.code == 'POPUP_BLOCKED' ? 'allow popups for this site and try again' : error.message);
  const popupToken = getStoredPopupToken();
  if (popupToken) store.set(popupToken);
  return getAccount(true);
}

export async function signOut()
{
  await authClient.signOut().catch(() => {});
  store.set(null);
  try { localStorage.removeItem('better-auth.popup_token'); } catch {}
  account = null;
}

export async function saveProfile(handle, initials)
{
  const { profile } = await api('PUT', '/api/profile', { handle, initials });
  if (account) account.profile = profile;
  return profile;
}

export const submitRun = run => api('POST', `/api/games/${GAME}/runs`, { week: run.week, replay: run.replay, score: run.score });
export const getLeaderboard = (period, limit=8) => api('GET', `/api/games/${GAME}/leaderboard?period=${period}&limit=${limit}`);
// all three boards plus, when signed in, your standing on each, totals and recent runs
export const getBoards = (limit=8) => api('GET', `/api/games/${GAME}/boards?limit=${limit}`);
export const getMyStats = () => api('GET', `/api/games/${GAME}/me`);
export const getRun = id => api('GET', `/api/games/${GAME}/runs/${encodeURIComponent(id)}`);

export const shareUrl = runId => {
  const url = new URL(location.href);
  url.search = '?run=' + runId;
  url.hash = '';
  return url.toString();
};
