// ope.cool arcade API — accounts, verified runs and leaderboards for the games on games.ope.cool.
// A Cloudflare Worker (Hono) in front of a Turso database. The games themselves stay static on GitHub Pages.
//
//   /api/auth/*                           Better Auth (email codes, Google, Discord)
//   GET  /api/config                      which sign-in methods are on, current week and day
//   GET  /api/me                          the signed-in player and their profile
//   PUT  /api/profile                     set handle + initials
//   POST /api/games/:game/runs            submit a run; it's replayed and verified before it's saved
//   GET  /api/games/:game/boards          all three boards (+ your standing and stats) in one go
//   GET  /api/games/:game/leaderboard     ?period=weekly|daily|alltime  best run per player
//   GET  /api/games/:game/runs/:id        one run (share links, watching a replay)
//   GET  /api/games/:game/me              your bests, ranks and recent runs

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createClient } from '@libsql/client/web';
import { createAuth, allowedOrigins, enabledProviders } from './auth.js';
import { GAMES } from './games.js';

const app = new Hono();
const PERIODS = ['weekly', 'daily', 'alltime'];
const utcDay = now => new Date(now).toISOString().slice(0, 10);

app.use('/api/*', async (c, next) =>
  cors({
    origin: allowedOrigins(c.env),
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['set-auth-token'], // the bearer token comes back in this header on sign-in
    maxAge: 600,
  })(c, next));

// one database client and auth instance per request (Workers share nothing between requests by default)
app.use('/api/*', async (c, next) =>
{
  const db = createClient({ url: c.env.TURSO_DATABASE_URL, authToken: c.env.TURSO_AUTH_TOKEN });
  c.set('db', db);
  c.set('auth', createAuth(c.env, db));
  await next();
});

app.on(['GET', 'POST'], '/api/auth/*', c => c.get('auth').handler(c.req.raw));

app.onError((err, c) =>
{
  console.error(err);
  return c.json({ error: 'something went wrong' }, 500);
});

const getSession = c => c.get('auth').api.getSession({ headers: c.req.raw.headers });

async function getProfile(db, userId)
{
  return toProfile((await db.execute(profileStatement(userId))).rows);
}

function gameFrom(c)
{
  const game = GAMES[c.req.param('game')];
  return game ? { id: c.req.param('game'), ...game } : null;
}

// SQL that picks the slice of runs a period covers
function periodFilter(period, game, now)
{
  if (period == 'weekly') return { where: 'game = ? AND week = ?', args: [game.id, game.currentWeek(now)] };
  if (period == 'daily') return { where: 'game = ? AND day = ?', args: [game.id, utcDay(now)] };
  return { where: 'game = ?', args: [game.id] };
}

// Each query to Turso is a network round trip, so these build statements that get batched together.
const entriesStatement = (filter, limit) => ({
  // each player's best run in the slice; ties go to whoever got there first
  sql: `WITH ranked AS (
          SELECT id, user_id, score, meters, created_at,
                 ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY score DESC, created_at ASC) AS n
          FROM run WHERE ${filter.where})
        SELECT r.id, r.score, r.meters, r.created_at, p.handle, p.initials
        FROM ranked r JOIN profile p ON p.user_id = r.user_id
        WHERE r.n = 1 ORDER BY r.score DESC, r.created_at ASC LIMIT ?`,
  args: [...filter.args, limit],
});
const toEntries = rows => rows.map((r, i) => ({
  rank: i + 1, runId: r.id, handle: r.handle, initials: r.initials, score: r.score, meters: r.meters, at: r.created_at,
}));

const standingStatement = (filter, userId) => ({
  sql: `WITH best AS (SELECT user_id, MAX(score) AS score FROM run WHERE ${filter.where} GROUP BY user_id),
             mine AS (SELECT score FROM best WHERE user_id = ?)
        SELECT (SELECT score FROM mine) AS score,
               (SELECT COUNT(*) FROM best WHERE score > (SELECT score FROM mine)) + 1 AS rank,
               (SELECT COUNT(*) FROM best) AS players`,
  args: [...filter.args, userId],
});
function toStanding(rows)
{
  const r = rows[0];
  return r.score == null ? { score: null, rank: null, players: Number(r.players) }
    : { score: Number(r.score), rank: Number(r.rank), players: Number(r.players) };
}

const totalsStatement = (game, userId) => ({
  sql: 'SELECT COUNT(*) AS runs, COALESCE(SUM(meters), 0) AS meters FROM run WHERE game = ? AND user_id = ?',
  args: [game.id, userId],
});
const recentStatement = (game, userId) => ({
  sql: `SELECT id, score, meters, death, week, created_at FROM run WHERE game = ? AND user_id = ?
        ORDER BY created_at DESC LIMIT 10`,
  args: [game.id, userId],
});
const profileStatement = userId => ({ sql: 'SELECT handle, initials FROM profile WHERE user_id = ?', args: [userId] });
const toProfile = rows => rows[0] ? { handle: rows[0].handle, initials: rows[0].initials } : null;

// a player's standing on every board, their totals and recent runs
async function personalStats(db, game, userId, now)
{
  const results = await db.batch([
    profileStatement(userId),
    ...PERIODS.map(p => standingStatement(periodFilter(p, game, now), userId)),
    totalsStatement(game, userId),
    recentStatement(game, userId),
  ], 'read');
  const [profile, weekly, daily, alltime, totals, recent] = results.map(r => r.rows);
  return {
    profile: toProfile(profile),
    boards: { weekly: toStanding(weekly), daily: toStanding(daily), alltime: toStanding(alltime) },
    totals: { runs: Number(totals[0].runs), meters: Number(totals[0].meters) },
    recent: recent.map(r => ({ id: r.id, score: r.score, meters: r.meters, death: r.death, week: r.week, at: r.created_at })),
  };
}

function randomId(length=10)
{
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), b => chars[b % chars.length]).join('');
}

async function sha256(text)
{
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

///////////////////////////////////////////////////////////////////////////////

app.get('/api/config', c => c.json({
  providers: enabledProviders(c.env),
  week: GAMES['spice-dreamer'].currentWeek(Date.now()),
  day: utcDay(Date.now()),
}));

app.get('/api/me', async c =>
{
  const session = await getSession(c);
  if (!session) return c.json({ user: null }, 401);
  const { id, email, name, image } = session.user;
  return c.json({ user: { id, email, name, image }, profile: await getProfile(c.get('db'), id) });
});

const HANDLE = /^[A-Za-z0-9_-]{3,16}$/;
const INITIALS = /^[A-Z]{3}$/;
const RESERVED = new Set(['admin', 'administrator', 'mod', 'moderator', 'ope', 'opecool', 'system', 'null', 'undefined', 'anonymous']);

app.put('/api/profile', async c =>
{
  const session = await getSession(c);
  if (!session) return c.json({ error: 'sign in first' }, 401);
  const body = await c.req.json().catch(() => ({}));
  const handle = String(body.handle || '').trim(), initials = String(body.initials || '').trim().toUpperCase();
  if (!HANDLE.test(handle)) return c.json({ error: 'handles are 3-16 letters, numbers, _ or -' }, 400);
  if (RESERVED.has(handle.toLowerCase())) return c.json({ error: 'that handle is reserved' }, 400);
  if (!INITIALS.test(initials)) return c.json({ error: 'initials are 3 letters' }, 400);

  const db = c.get('db'), now = Date.now(), key = handle.toLowerCase();
  const taken = await db.execute({ sql: 'SELECT user_id FROM profile WHERE handle_key = ?', args: [key] });
  if (taken.rows[0] && taken.rows[0].user_id != session.user.id) return c.json({ error: 'that handle is taken' }, 409);
  await db.execute({
    sql: `INSERT INTO profile (user_id, handle, handle_key, initials, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (user_id) DO UPDATE SET handle = excluded.handle, handle_key = excluded.handle_key,
            initials = excluded.initials, updated_at = excluded.updated_at`,
    args: [session.user.id, handle, key, initials, now, now],
  });
  return c.json({ profile: { handle, initials } });
});

app.post('/api/games/:game/runs', async c =>
{
  const game = gameFrom(c);
  if (!game) return c.json({ error: 'unknown game' }, 404);
  const session = await getSession(c);
  if (!session) return c.json({ error: 'sign in to post scores' }, 401);
  const db = c.get('db'), userId = session.user.id;
  const body = await c.req.json().catch(() => ({}));
  const now = Date.now();
  const result = game.verify(body, now);
  if (result.error) return c.json({ error: result.error }, 422);

  // one round trip: their profile, whether this exact run was already posted, and their best before it
  const hash = await sha256(body.replay);
  const [profile, existing, before] = await db.batch([
    profileStatement(userId),
    { sql: 'SELECT id FROM run WHERE game = ? AND user_id = ? AND replay_hash = ?', args: [game.id, userId, hash] },
    standingStatement(periodFilter('alltime', game, now), userId),
  ], 'read');
  if (!profile.rows[0]) return c.json({ error: 'pick a handle first' }, 409);

  // a resubmitted run (say, a retry after a dropped connection) returns the original instead of posting twice
  const duplicate = !!existing.rows[0];
  const id = existing.rows[0]?.id || randomId();
  const best = toStanding(before.rows).score;

  // and one more: save it, then read where it lands on each board
  const writes = duplicate ? [] : [{
    sql: `INSERT INTO run (id, game, user_id, score, meters, frames, death, week, day, sim_version, replay, replay_hash, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, game.id, userId, result.score, result.meters, result.frames, result.death, result.week,
      utcDay(now), result.simVersion, body.replay, hash, now],
  }];
  const results = await db.batch([...writes, ...PERIODS.map(p => standingStatement(periodFilter(p, game, now), userId))], 'write');
  const standings = results.slice(writes.length).map(r => toStanding(r.rows));
  const boards = Object.fromEntries(PERIODS.map((p, i) => [p, standings[i]]));

  return c.json({ run: { id, score: result.score, meters: result.meters, death: result.death },
    duplicate, personalBest: !duplicate && (best == null || result.score > best), boards }, duplicate ? 200 : 201);
});

// everything the game's board screen needs, in one request and one round trip to the database
app.get('/api/games/:game/boards', async c =>
{
  const game = gameFrom(c);
  if (!game) return c.json({ error: 'unknown game' }, 404);
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit')) || 8));
  const now = Date.now(), db = c.get('db');
  const session = await getSession(c), userId = session?.user.id;
  const statements = PERIODS.map(p => entriesStatement(periodFilter(p, game, now), limit));
  if (userId)
    statements.push(profileStatement(userId), ...PERIODS.map(p => standingStatement(periodFilter(p, game, now), userId)),
      totalsStatement(game, userId), recentStatement(game, userId));
  const rows = (await db.batch(statements, 'read')).map(r => r.rows);
  const out = { week: game.currentWeek(now), day: utcDay(now), me: null };
  PERIODS.forEach((p, i) => out[p] = { entries: toEntries(rows[i]) });
  if (userId)
  {
    const [profile, weekly, daily, alltime, totals, recent] = rows.slice(PERIODS.length);
    const boards = { weekly: toStanding(weekly), daily: toStanding(daily), alltime: toStanding(alltime) };
    PERIODS.forEach(p => out[p].me = boards[p]);
    out.me = {
      profile: toProfile(profile), boards,
      totals: { runs: Number(totals[0].runs), meters: Number(totals[0].meters) },
      recent: recent.map(r => ({ id: r.id, score: r.score, meters: r.meters, death: r.death, week: r.week, at: r.created_at })),
    };
  }
  return c.json(out);
});

app.get('/api/games/:game/leaderboard', async c =>
{
  const game = gameFrom(c);
  if (!game) return c.json({ error: 'unknown game' }, 404);
  const period = PERIODS.includes(c.req.query('period')) ? c.req.query('period') : 'weekly';
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 10));
  const now = Date.now(), filter = periodFilter(period, game, now), db = c.get('db');
  const session = await getSession(c);
  const statements = [entriesStatement(filter, limit)];
  if (session) statements.push(standingStatement(filter, session.user.id));
  const [entries, me] = await db.batch(statements, 'read');
  return c.json({
    period, week: game.currentWeek(now), day: utcDay(now),
    entries: toEntries(entries.rows), me: me ? toStanding(me.rows) : null,
  });
});

app.get('/api/games/:game/runs/:id', async c =>
{
  const game = gameFrom(c);
  if (!game) return c.json({ error: 'unknown game' }, 404);
  const { rows } = await c.get('db').execute({
    sql: `SELECT r.id, r.score, r.meters, r.frames, r.death, r.week, r.day, r.sim_version, r.replay, r.created_at,
                 p.handle, p.initials
          FROM run r JOIN profile p ON p.user_id = r.user_id WHERE r.game = ? AND r.id = ?`,
    args: [game.id, c.req.param('id')],
  });
  if (!rows[0]) return c.json({ error: 'run not found' }, 404);
  const r = rows[0];
  return c.json({ run: {
    id: r.id, handle: r.handle, initials: r.initials, score: r.score, meters: r.meters, frames: r.frames,
    death: r.death, week: r.week, day: r.day, simVersion: r.sim_version, replay: r.replay, at: r.created_at,
  } });
});

app.get('/api/games/:game/me', async c =>
{
  const game = gameFrom(c);
  if (!game) return c.json({ error: 'unknown game' }, 404);
  const session = await getSession(c);
  if (!session) return c.json({ error: 'sign in first' }, 401);
  return c.json(await personalStats(c.get('db'), game, session.user.id, Date.now()));
});

app.get('/', c => c.text('ope.cool arcade api'));

export default app;
