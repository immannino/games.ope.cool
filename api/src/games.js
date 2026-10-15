// Games that can post scores. Each one checks a submitted run by replaying it through the game's own
// simulation (imported straight from the game's folder in this repo), so a score is only ever what the
// recorded inputs actually produce. To add a game: give it a deterministic sim with a replay function
// and register it here.

import * as spiceDreamer from '../../games/spice-dreamer/src/sim.js';

const MAX_REPLAY_CHARS = 400_000;
const WEEK_GRACE_MS = 15*60*1000; // a run that started just before the Sunday rollover still counts

export const GAMES = {
  'spice-dreamer': {
    title: 'Spice Dreamer',
    currentWeek: now => spiceDreamer.weekNumber(now),
    verify(body, now)
    {
      const week = Number(body.week);
      if (week !== spiceDreamer.weekNumber(now) && week !== spiceDreamer.weekNumber(now - WEEK_GRACE_MS))
        return { error: "that week's course has closed" };
      if (typeof body.replay != 'string' || body.replay.length > MAX_REPLAY_CHARS)
        return { error: 'missing or oversized replay' };
      let result;
      try { result = spiceDreamer.replayRun(week, body.replay); }
      catch (e) { return { error: 'unreadable replay: ' + e.message }; }
      if (!result.ok) return { error: result.error };
      if (result.score !== Number(body.score)) return { error: 'score does not match the replay' };
      return {
        week, score: result.score, meters: result.meters, frames: result.frames,
        death: result.deathReason, simVersion: spiceDreamer.SIM_VERSION,
      };
    },
  },
};
