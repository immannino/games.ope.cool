// Time of day: the sky, sand and light at any point in a day, plus where the sun and moon are.
// t is a fraction of a day: 0 is midnight, .25 sunrise-ish, .5 noon, .76 sunset.
// The menus use the player's real local time and the real moon phase; a run speeds through
// a whole day while you play.

import { rgb } from 'littlejsengine';

// keyframes around the day. sky: 8 bands top to horizon, ground: 6 bands horizon to camera
const KEYS = [
  { t: 0,   light: .25,
    sky: ['#03020c', '#060518', '#0a0a24', '#100f33', '#16143f', '#1d1a4a', '#262252', '#302a58'],
    ground: ['#4a3a52', '#433348', '#3b2c3f', '#332636', '#2b202e', '#241a26'],
    mesaFar: '#141026', mesaMid: '#1c1530', duneFar: '#3a2c48', duneTop: '#4c3a5a', ripple: '#2a1f30', fore: '#120c16', foreTop: '#22182a' },
  { t: .21, light: .5,
    sky: ['#0b0820', '#17103a', '#2a1650', '#45205e', '#6a2c66', '#94406a', '#c25e6a', '#e88a6e'],
    ground: ['#a86a5a', '#985c50', '#874f47', '#76433e', '#663836', '#572f2f'],
    mesaFar: '#2a1838', mesaMid: '#3c2040', duneFar: '#7a4048', duneTop: '#9a5050', ripple: '#6a3c38', fore: '#3a1c1a', foreTop: '#552a24' },
  { t: .3,  light: 1,
    sky: ['#3a6aa8', '#4c7cb4', '#6290c0', '#7aa4c8', '#96b8cc', '#b4c8cc', '#d6d4c0', '#f2dcb0'],
    ground: ['#f4c890', '#ecb87c', '#e2a86c', '#d4985e', '#c48852', '#b07848'],
    mesaFar: '#8a7090', mesaMid: '#a07a7a', duneFar: '#d49a68', duneTop: '#e8b47c', ripple: '#c08858', fore: '#7a4a2a', foreTop: '#9a6038' },
  { t: .5,  light: 1,
    sky: ['#2a5ea6', '#3468ac', '#3e74b2', '#4c82b8', '#5e92be', '#78a6c4', '#98bcca', '#bcd0cc'],
    ground: ['#f6d09c', '#f0c488', '#e6b476', '#daa466', '#cc9458', '#ba834c'],
    mesaFar: '#9a86a0', mesaMid: '#b48a78', duneFar: '#dca674', duneTop: '#f0c088', ripple: '#c89060', fore: '#845030', foreTop: '#a46a40' },
  { t: .68, light: .9,
    sky: ['#3c5c98', '#5a6aa0', '#8a78a0', '#b8869a', '#de9a8a', '#f2b07a', '#f8c878', '#fcdc90'],
    ground: ['#f4b06a', '#eaa05c', '#de9050', '#ce8046', '#bc703e', '#a86236'],
    mesaFar: '#7a4a6a', mesaMid: '#9a5250', duneFar: '#d07048', duneTop: '#e88858', ripple: '#b86a3c', fore: '#70361e', foreTop: '#944a2a' },
  { t: .76, light: .75, // the original sunset
    sky: ['#1e0b3a', '#3a1256', '#651a66', '#9c2462', '#d2434e', '#f27a45', '#ffb45e', '#ffd98a'],
    ground: ['#f0a35c', '#e48e4c', '#d77a40', '#c66a38', '#b25a31', '#9c4c2b'],
    mesaFar: '#6a2c5e', mesaMid: '#8c3a4c', duneFar: '#c45a3c', duneTop: '#de7448', ripple: '#b4582e', fore: '#6e321e', foreTop: '#94472a' },
  { t: .83, light: .45,
    sky: ['#0c0820', '#1a0f38', '#2e1650', '#4a1e5c', '#6c2862', '#8e3460', '#ae4458', '#c85a50'],
    ground: ['#9a5a48', '#8a4e40', '#7a4339', '#6a3932', '#5a302b', '#4c2824'],
    mesaFar: '#24142e', mesaMid: '#341a34', duneFar: '#6a3436', duneTop: '#84403c', ripple: '#5a3028', fore: '#2e1612', foreTop: '#44201a' },
  { t: .92, light: .25 }, // back to night (filled in from the first key)
];
KEYS[KEYS.length - 1] = { ...KEYS[0], t: .92 };

const parse = h => [parseInt(h.slice(1, 3), 16)/255, parseInt(h.slice(3, 5), 16)/255, parseInt(h.slice(5, 7), 16)/255];
for (const k of KEYS)
  for (const field of Object.keys(k))
    if (Array.isArray(k[field])) k[field] = k[field].map(parse);
    else if (typeof k[field] == 'string') k[field] = parse(k[field]);

const mix = (a, b, p) => rgb(a[0] + (b[0] - a[0])*p, a[1] + (b[1] - a[1])*p, a[2] + (b[2] - a[2])*p);

// the palette and light level at time of day t
export function skyAt(t)
{
  t = ((t % 1) + 1) % 1;
  let i = KEYS.length - 1;
  while (i > 0 && KEYS[i].t > t) i--;
  const a = KEYS[i], b = KEYS[i + 1] || { ...KEYS[0], t: 1 };
  const raw = (t - a.t)/(b.t - a.t), p = raw*raw*(3 - 2*raw);
  const out = { t, light: a.light + (b.light - a.light)*p };
  for (const field of Object.keys(a))
    if (Array.isArray(a[field]) && Array.isArray(a[field][0])) out[field] = a[field].map((c, j) => mix(c, b[field][j], p));
    else if (Array.isArray(a[field])) out[field] = mix(a[field], b[field], p);
  return out;
}

// sun from just before dawn to just after dusk, rising on the left and setting on the right
export function sunAt(t)
{
  const p = (t - .2)/(.83 - .2);
  if (p <= 0 || p >= 1) return null;
  return { p, x: 20 + p*240, height: Math.sin(p*Math.PI) };
}

export function moonAt(t)
{
  const p = (((t + .25) % 1) - 0)/.55; // up from about 6pm to about 7am
  if (p <= 0 || p >= 1) return null;
  return { p, x: 30 + p*250, height: Math.sin(p*Math.PI) };
}

// the player's real local time of day
export function localTimeOfDay(date=new Date())
{
  return (date.getHours()*3600 + date.getMinutes()*60 + date.getSeconds())/86400;
}

// moon phase from the real date: 0 new, .5 full
export function moonPhase(date=new Date())
{
  const SYNODIC = 29.530588853, KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
  const days = (date.getTime() - KNOWN_NEW_MOON)/864e5;
  return ((days % SYNODIC) + SYNODIC) % SYNODIC/SYNODIC;
}
