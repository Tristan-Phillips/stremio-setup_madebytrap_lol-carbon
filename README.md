# Stremio, Sorted — stremio-setup.madebytrap.lol

Self-service page: a visitor enters their own email, picks packs, taps go — the
page creates a Stremio account and loads the add-ons. So you stop setting up
accounts by hand under your `carbonarchive.com` aliasing.

## Architecture

- **Frontend** (this dir, static): the whole wizard + **client-side** account
  creation. Email + a generated password go straight from the browser to
  `api.strem.io` and **never touch our server** (verified: Stremio API + addon
  hosts all send `Access-Control-Allow-Origin: *`).
- **Sidecar**: [`services/proxy/stremio-setup-svc`](../../../../services/proxy/stremio-setup-svc) —
  Turnstile verify + per-IP rate-limit + the public "fun" pack tally. No PII.
- **Edge**: Caddy block for `stremio-setup.madebytrap.lol` (static + `/api/*` →
  sidecar), mounted in [`web/root/_edge`](../../../root/_edge).

## Single source of truth

[`public/data/stremio-addons.json`](public/data/stremio-addons.json). Edit +
redeploy. `addons` are defined once; `packs` reference them by id; `baseline`
is always-on; `defaults.remove` strips unwanted Stremio default add-ons.

### Add / fix an add-on
1. Drop its `manifest` URL into the addon entry.
2. Remove `needs_url: true` (and `configure_url`) so it auto-applies instead of
   showing as a "Configure & install" link-out.

## Categories (6, all functionally verified 2026-06-26)

Each was tested end-to-end: catalogs return items AND titles return playable streams.

| Preset | Works because | Notes |
|---|---|---|
| 🎬 Movies & TV | Streaming Catalogs + Torrentio (50 streams) | the default |
| 🍥 Anime | Kitsu/MAL catalogs + Torrentio-Anime (50 streams) + AniList tracking | |
| 🎞️ Niche & Indie | Torrent Catalogs + baseline Torrentio | |
| 💎 4K & Premium | Torrentio tuned to 1080p+/4K only | debrid recommended (big files) |
| 🔪 Extreme Horror | Scary Only (52 subgenre catalogs) + Torrentio (50 streams) | |
| 🔞 Adult | Hentai (direct), TPB/AdultStremio/PornTube (torrent/debrid), cams (configure) | age-gated |

**Removed for the initial ship (no working free catalog → re-add later):**
- **Sports** + **Live TV** — every free addon is dead/unavailable.
- **Documentaries** — with no catalog it added nothing beyond the baseline (redundant).
- **Kids** — without a curated age-rated catalog it can't honestly deliver kid-safe.

All four keep their addon entries (`dead:true`, hidden). To bring one back: self-host
its catalog (e.g. `jaruba/stremio-imdb-list` for docs, `manuelford/stremio-kids-addon`
for kids), set the manifest, flip off `dead`, and re-add the pack.

## Before going live (config)

- `public/js/app.js` → `CONFIG.turnstileSitekey` — **set** (`0x4AAAAAADraLSMn27eQpgep`, public).
- `services/proxy/stremio-setup-svc/.env` → `TURNSTILE_SECRET` — **set** (gitignored). Never put it in `.env.example`.
- `stremio-addons.json` → optional: AllDebrid/Premiumize referral ids (Real-Debrid `19347258`
  set) and a free **RPDB** key on `rottentomatoes` (else poster ratings blank).

## Deploy

```sh
# sidecar (.env already holds TURNSTILE_SECRET)
cd services/proxy/stremio-setup-svc && docker compose up -d --build
# edge (picks up the static mount + Caddy route)
cd ../../../web/root/_edge && docker compose up -d --build && docker compose exec edge caddy reload --config /etc/caddy/Caddyfile
```

Then add the Cloudflare Tunnel route: `stremio-setup.madebytrap.lol → http://web_edge:8080`.

## Licensing

- **Code** (HTML/CSS/JS): [GNU AGPLv3](LICENSE).
- **Content** — copy, branding, and curated add-on lists: **© Tristan
  Phillips, all rights reserved.** Not covered by the code license; no reuse
  without permission.
