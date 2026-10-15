# Next steps

Where Spice Dreamer and the arcade API stand, and what's left to get logins and leaderboards working for real players.

**Already done:** the API is deployed at `https://ope-arcade-api.anthonyjosephmannino.workers.dev`. It accepts requests
from `https://games.ope.cool`, and email sign-in is switched on. The Turso database `arcade` is set up and empty.

## Required before players can log in

### 1. Push the game

Nothing since the initial commit is committed: the game is now `games/spice-dreamer/` (it was `games/tinybonk/`), and
the accounts, leaderboards, day/night, screensaver, music and credits are all new. Commit and push `main`, and the
GitHub Pages workflow deploys it.

- The game now lives at `games.ope.cool/spice-dreamer/`. `site/tinybonk/` redirects the old address, including shared
  `?run=` links.
- The workflow installs the game's new `better-auth` dependency from `package-lock.json`. No workflow changes needed.

### 2. Set up email delivery (Resend)

Email codes are the only sign-in method switched on. Until this is done, the codes only go to the API's log, so no
player can sign in.

1. Sign up at [resend.com](https://resend.com) and add the domain `ope.cool`.
2. Add the DNS records Resend shows in DNSimple, and wait for Resend to mark the domain verified.
3. Create an API key, then in `api/`:
   ```sh
   npx wrangler secret put RESEND_API_KEY
   ```
   This takes effect immediately, no redeploy needed. Codes come from `arcade@ope.cool` (`EMAIL_FROM` in `api/wrangler.jsonc`).

Before Resend is ready, you can still sign in on the live site yourself: run `npx wrangler tail` in `api/` and copy
the code from the log.

### 3. Check it end to end

On the live site: sign in, pick a handle, finish a run, check it lands on the boards, share it, open the share link.

## Optional sign-in methods

Each one shows up in the sign-in panel by itself once its two secrets are set.

### Google

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID (Web application).
   - Authorized JavaScript origin: `https://ope-arcade-api.anthonyjosephmannino.workers.dev`
   - Authorized redirect URI: `https://ope-arcade-api.anthonyjosephmannino.workers.dev/api/auth/callback/google`
2. Set the OAuth consent screen to **In production**. In "Testing" only listed accounts can sign in. Basic sign-in
   (email and profile) doesn't need Google's review.
3. `npx wrangler secret put GOOGLE_CLIENT_ID` and `npx wrangler secret put GOOGLE_CLIENT_SECRET`

### Discord

1. discord.com/developers/applications → New Application → OAuth2.
   - Redirect: `https://ope-arcade-api.anthonyjosephmannino.workers.dev/api/auth/callback/discord`
2. `npx wrangler secret put DISCORD_CLIENT_ID` and `npx wrangler secret put DISCORD_CLIENT_SECRET`

## Later

- **Music permission:** "Spice Dream" by nic and reuben is marked "all rights reserved" on Bandcamp. You're emailing
  them to ask about using it; if they want specific credit wording, it goes in `games/spice-dreamer/src/credits.js`.
- **Deploy the API from CI:** `api/` only deploys when someone runs `npx wrangler deploy`. A GitHub Actions job (with
  a `CLOUDFLARE_API_TOKEN` repo secret) could deploy it on pushes that touch `api/` or a game's `sim.js`.
- **Custom domain:** `ope.cool` DNS is on DNSimple, so the API lives on `*.workers.dev` and uses bearer tokens.
  Moving DNS to Cloudflare would allow `api.ope.cool` (update `BETTER_AUTH_URL`, `API_URL` in
  `games/spice-dreamer/src/arcade.js`, and the OAuth callback URLs).
- **Worm redesign:** a more Dune-like sandworm.
- **Moderation:** handles are only checked for format, a reserved list and uniqueness. If the boards get public,
  add a profanity filter or a way to rename/remove a player.
- **Replays and bots:** server replays stop faked scores, but not a bot that genuinely plays. Worth watching the
  top of the boards if it ever matters.

## Handy references

- `api/README.md`: running, migrating and deploying the API.
- `games/spice-dreamer/`: `npm run dev` for the game (uses the local API at `http://localhost:8787`), `npm test`
  for replay determinism.
- URL options: `?kiosk` (screensaver / cabinet mode), `?time=22` (pin the time of day), `?start=2500` (start a
  practice run part way in; not posted), `?run=<id>` (watch a shared run).
