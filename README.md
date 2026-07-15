# Stremio, Sorted — stremio-setup.madebytrap.lol

Self-service page: a visitor enters their own email, picks packs, taps go — the
page creates a Stremio account and loads the add-ons. So you stop setting up
accounts by hand under your `carbonarchive.com` aliasing.

## Architecture

- **Frontend** (this dir, static): the whole wizard + **client-side** account
  creation. Email + a generated password go straight from the browser to
  `api.strem.io` and **never touch our server** (verified: Stremio API + addon
  hosts all send `Access-Control-Allow-Origin: *`).
- **Sidecar**: `stremio-setup-svc` — Turnstile verify + per-IP rate-limit + the
  public "fun" pack tally. No PII. **Not yet migrated into carbon_god** — still
  lives in old carbon at `services/proxy/stremio-setup-svc`; this repo is
  frontend-only until that's brought over as its own project.
- **Edge**: Caddy block for `stremio-setup.madebytrap.lol` (static + `/api/*` →
  sidecar). **Also not yet migrated** — old carbon's edge config lives at
  `web/root/_edge`; carbon_god doesn't have an equivalent yet.

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
- Sidecar's `.env` → `TURNSTILE_SECRET` — set on the old-carbon instance
  (gitignored there too). Never put it in `.env.example`.
- `stremio-addons.json` → optional: AllDebrid/Premiumize referral ids (Real-Debrid `19347258`
  set) and a free **RPDB** key on `rottentomatoes` (else poster ratings blank).

## Deploy

Static frontend only, in carbon_god:

```sh
python3 -m http.server   # or any static file server
```

Full production deploy (Turnstile verification, rate-limiting, the live tally)
needs the sidecar + edge config migrated in first — see Architecture above.
The old-carbon deploy sequence (sidecar `docker compose up`, edge reload, then
a Cloudflare Tunnel route to the edge container) still applies there until
this project's backend half moves over.

## Licensing

- **Code** (HTML/CSS/JS): [GNU AGPLv3](LICENSE).
- **Content** — copy, branding, and curated add-on lists: **© Tristan
  Phillips, all rights reserved.** Not covered by the code license; no reuse
  without permission.
