# ope.cool arcade API

Accounts, verified runs and leaderboards for the games on games.ope.cool. A Cloudflare Worker (Hono + Better Auth)
in front of the Turso database `arcade`. The games stay static on GitHub Pages and call this API.

Live at `https://ope-arcade-api.anthonyjosephmannino.workers.dev` (routes are listed at the top of `src/index.js`).

## How scores stay honest

A game posts its run's recorded inputs, not just a score. The API replays them through the game's own simulation
(`games/<slug>/src/sim.js`, imported directly, see `src/games.js`) and stores the score the replay produces.
A faked score doesn't match its replay and is rejected. Replays only count on the current week's course.

## Local development

```sh
npm install
npm run dev        # wrangler dev on http://localhost:8787, using .dev.vars
npm run migrate    # create/update tables in Turso (Better Auth's + migrations/*.sql); safe to re-run
```

`.dev.vars` (not committed) holds `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL=http://localhost:8787` and `DEV_MODE=true` (allows localhost game origins).
The game uses `http://localhost:8787` automatically when run with `npm run dev`.

Without Resend set up, email sign-in codes are only printed to the log: watch `npm run dev`, or
`npx wrangler tail` for the deployed Worker.

## Deploy

```sh
npx wrangler deploy
```

Secrets live in Cloudflare (`npx wrangler secret put NAME`): `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`BETTER_AUTH_SECRET`, and once set up, the ones below. Sign-in methods switch on by themselves when their secrets exist.

## Turning on Google, Discord and email delivery

**Google** — Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID (Web application).
- Authorized JavaScript origin: `https://ope-arcade-api.anthonyjosephmannino.workers.dev`
- Authorized redirect URI: `https://ope-arcade-api.anthonyjosephmannino.workers.dev/api/auth/callback/google`
- Then `npx wrangler secret put GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

**Discord** — discord.com/developers/applications → New Application → OAuth2.
- Redirect: `https://ope-arcade-api.anthonyjosephmannino.workers.dev/api/auth/callback/discord`
- Then `npx wrangler secret put DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.

**Email (Resend)** — resend.com → Domains → add `ope.cool` and add the DNS records it shows in DNSimple.
- Then `npx wrangler secret put RESEND_API_KEY`. The sender is `EMAIL_FROM` in `wrangler.jsonc` (`arcade@ope.cool`).

For local testing of Google/Discord, add the same values to `.dev.vars` and register the `http://localhost:8787`
callback URLs too.

## Adding another game

Give the game a deterministic sim with a replay function (see `games/spice-dreamer/src/sim.js` and its `npm test`),
register it in `src/games.js`, and call the same endpoints with its slug.
