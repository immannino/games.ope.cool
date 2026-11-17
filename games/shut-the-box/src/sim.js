// SHUT THE BOX simulation: everything that decides how a match turns out lives here.
//
// It's pure and deterministic: no engine, no DOM, no clock, no Math.random. Dice come from a seeded
// generator, so the same seed and the same choices always give the same match in any JS engine. The game
// draws a match from this file; the dice physics (packages/dice-physics) is rigged to show what this decides.
//
// Rules: nine tiles, 1 to 9. Roll two dice (one die once 7, 8 and 9 are all shut) and shut any open tiles
// that add up to the roll. When no tiles fit, the round ends and the tiles still open are your pips left.
// A match is three rounds. Points per round are 45 minus the pips left, plus a bonus for shutting the box.

export const SIM_VERSION = 1;
export const TILES = 9;
export const ROUNDS = 3;
export const FULL = (1 << TILES) - 1;     // every tile open: bit n is tile n+1
export const SHUT_BONUS = 25;
export const ROUND_MAX = 45 + SHUT_BONUS; // a shut box
export const MATCH_MAX = ROUNDS*ROUND_MAX;

// small fast seeded generator (mulberry32): only integer maths, so it's identical everywhere
export function seededRandom(seed)
{
  let a = seed >>> 0;
  return () =>
  {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// pips on a set of tiles, indexed by bitmask
export const SUMS = new Uint8Array(1 << TILES);
for (let m = 1; m < SUMS.length; m++)
{
  const low = m & -m;
  SUMS[m] = SUMS[m ^ low] + (31 - Math.clz32(low)) + 1;
}
export const maskOf = tiles => tiles.reduce((m, t) => m | 1 << (t - 1), 0);
export const tilesOf = mask => { const t = []; for (let i = 0; i < TILES; i++) if (mask >> i & 1) t.push(i + 1); return t; };

// can some set of open tiles make exactly this total?
export function hasMove(open, total)
{
  for (let s = open; s; s = (s - 1) & open)
    if (SUMS[s] === total) return true;
  return false;
}

// every set of open tiles that makes the total (used by the bot and the hint-free tests)
export function moves(open, total)
{
  const out = [];
  for (let s = open; s; s = (s - 1) & open)
    if (SUMS[s] === total) out.push(s);
  return out;
}

// one die is rolled once the 7, 8 and 9 are all shut
export const oneDie = open => (open & 0b111000000) === 0;

///////////////////////////////////////////////////////////////////////////////
// a match
//
// phase: 'roll'     waiting for a roll
//        'move'     dice are down and at least one set of tiles fits: waiting for shut()
//        'roundEnd' the round just ended (no move fits, or the box is shut): call nextRound()
//        'over'     the match is finished

export function createMatch(seed)
{
  return {
    rng: seededRandom(seed),
    round: 0,              // 0-based
    open: FULL,
    dice: [0, 0],          // [0, 0] until the first roll; a single die leaves the second at 0
    total: 0,
    phase: 'roll',
    rounds: [],            // finished rounds: { left, shut, points }
    score: 0,
    shuts: 0,              // boxes shut so far
    turns: 0,              // shuts made, for the record
  };
}

export const pipsLeft = m => SUMS[m.open];

export function roll(m)
{
  if (m.phase !== 'roll') throw new Error('not time to roll');
  const a = 1 + Math.floor(m.rng()*6), b = 1 + Math.floor(m.rng()*6); // always two draws, so a replay can't drift
  m.dice = oneDie(m.open) ? [a, 0] : [a, b];
  m.total = m.dice[0] + m.dice[1];
  if (hasMove(m.open, m.total)) m.phase = 'move';
  else endRound(m);
  return m.dice;
}

// is this exact set of tiles a legal play for the current roll?
export const isMove = (m, mask) => m.phase === 'move' && mask > 0 && (mask & ~m.open) === 0 && SUMS[mask] === m.total;

export function shut(m, mask)
{
  if (!isMove(m, mask)) throw new Error('that play does not fit the roll');
  m.open &= ~mask;
  m.turns++;
  if (m.open === 0) endRound(m, true);
  else m.phase = 'roll';
}

function endRound(m, shutBox=false)
{
  const left = SUMS[m.open];
  const points = 45 - left + (shutBox ? SHUT_BONUS : 0);
  m.rounds.push({ left, shut: shutBox, points });
  m.score += points;
  if (shutBox) m.shuts++;
  m.phase = 'roundEnd';
}

export function nextRound(m)
{
  if (m.phase !== 'roundEnd') throw new Error('the round is not over');
  m.round++;
  m.open = FULL;
  m.dice = [0, 0];
  m.total = 0;
  m.phase = m.round >= ROUNDS ? 'over' : 'roll';
}
