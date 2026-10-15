# games.ope.cool

Small browser games, hosted together on GitHub Pages.

```
site/            static landing page (copied as-is to the site root)
games/<slug>/    one standalone Vite + LittleJS project per game, served at /<slug>/
api/             accounts + leaderboards API (Cloudflare Worker + Turso), see api/README.md
scripts/         local helpers
```

## Local dev

```sh
cd games/spice-dreamer && npm install && npm run dev   # work on one game
./scripts/build-all.sh && npx serve _site         # preview the whole site as deployed
```

## Adding a game

1. Put the project in `games/<slug>/` with its own `package.json` + `package-lock.json` and a `build` script that outputs to `dist/`.
2. Set `base: './'` in its `vite.config.js` so assets resolve under `/<slug>/`.
3. Add a card to `site/index.html`.

CI picks up new folders automatically.

## Deploys

`.github/workflows/deploy.yml` runs on pushes to `main` that touch `games/`, `site/` or the workflow itself. Each game's `dist/` is cached under a hash of that game's files, so only changed games are rebuilt; unchanged ones are restored from cache. All builds are then assembled with `site/` into a single Pages deploy. Pull requests run the build without deploying.

## Share links & previews

Each page has its own description, canonical URL and a 1200×630 `og.jpg` for link previews (`site/og.jpg`, `games/<slug>/public/og.jpg`). New games need the same tags and image, plus an entry in `site/sitemap.xml`.

Ice Cold Beer takes `?board=zeke` (or `zekes`, `zekes-peak`, …) to open on Zeke's Peak, and the URL updates when you switch machines. Link previews can't see query strings, so share **https://games.ope.cool/iced-cold-beer/zekes-peak/** instead: it shows Zeke's own preview card and forwards to `?board=zeke`.
