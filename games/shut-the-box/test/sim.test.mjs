// The rules: scoring, legal moves, the one-die rule. Run with: npm test
import { createMatch, roll, shut, nextRound, isMove, moves, hasMove, oneDie, SUMS, ROUNDS, MATCH_MAX, FULL, seededRandom, maskOf } from '../src/sim.js';

let failures = 0;
const check = (ok, ...msg) => { if (!ok) { failures++; console.log('FAIL', ...msg); } };

// a bot plays whole matches; scores and states must stay consistent
let total = 0, shutBoxes = 0;
for (let seed = 1; seed <= 500; seed++)
{
  const pick = seededRandom(seed*7), m = createMatch(seed);
  let rounds = 0;
  while (m.phase !== 'over')
  {
    if (m.phase === 'roll') roll(m);
    else if (m.phase === 'roundEnd') { rounds++; nextRound(m); }
    else
    {
      const options = moves(m.open, m.total);
      check(options.length > 0, 'move phase with no moves');
      const mask = options[Math.floor(pick()*options.length)];
      check(isMove(m, mask), 'bot chose an illegal move');
      shut(m, mask);
    }
  }
  check(rounds === ROUNDS && m.rounds.length === ROUNDS, 'wrong round count');
  check(m.score === m.rounds.reduce((a, r) => a + r.points, 0), 'score does not add up');
  check(m.score >= 0 && m.score <= MATCH_MAX, 'score out of range', m.score);
  total += m.score; shutBoxes += m.shuts;
}
// illegal plays are refused
const m = createMatch(3);
roll(m);
let threw = false;
try { shut(m, FULL); } catch { threw = true; }
check(threw || m.phase !== 'move', 'a play that does not fit was accepted');
check(oneDie(maskOf([1, 2, 3, 4, 5, 6])) && !oneDie(FULL), 'one-die rule');
let tableOk = true;
for (let open = 1; open < 512; open++) for (let t = 2; t <= 12; t++)
{
  let any = false;
  for (let s = 1; s < 512; s++) if ((s & ~open) === 0 && SUMS[s] === t) any = true;
  if (any !== hasMove(open, t) || any !== (moves(open, t).length > 0)) tableOk = false;
}
check(tableOk, 'move tables disagree with brute force');
console.log(`rules: 500 random matches, avg score ${(total/500).toFixed(1)}, boxes shut ${shutBoxes}, move tables ok: ${tableOk}`);
if (failures) process.exit(1);
