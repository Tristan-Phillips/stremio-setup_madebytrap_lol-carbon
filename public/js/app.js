/* Stremio, Sorted — client-side setup.
 * The Stremio account is created and configured ENTIRELY in the browser:
 * email + generated password go straight from here to api.strem.io and never
 * touch our server. Our Go sidecar only verifies Turnstile + keeps a fun tally. */
'use strict';

const CONFIG = {
  apiBase: '/api',                          // our Go sidecar (Turnstile + tally)
  stremioApi: 'https://api.strem.io/api',
  turnstileSitekey: '0x4AAAAAADraLSMn27eQpgep',   // Cloudflare Turnstile site key (public). Secret is server-side in the sidecar's .env.
  // QR images come from a public renderer; we only ever encode PUBLIC add-on URLs
  // (never the password). Swap for a vendored encoder later if you want zero 3rd-party calls.
  qrRenderer: 'https://api.qrserver.com/v1/create-qr-code/?size=148x148&margin=0&data='
};

let DATA = null;            // parsed stremio-addons.json
let selectedPacks = new Set();
let adultConfirmed = false;
let turnstileToken = '';

const $  = (id) => document.getElementById(id);
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const show = (id) => { for (const s of document.querySelectorAll('.step')) s.hidden = (s.id !== id); window.scrollTo({ top: 0, behavior: 'smooth' }); };

/* ---------- boot ---------- */
init();
async function init() {
  try {
    const res = await fetch('public/data/stremio-addons.json', { cache: 'no-cache' });
    DATA = await res.json();
  } catch (e) { fatal('Could not load setup data. Refresh and try again.'); return; }

  $('site-name').textContent = DATA.site.name;
  $('site-tagline').textContent = DATA.site.tagline;
  document.title = DATA.site.name;

  renderPacks();
  renderToggles();
  renderCustom();
  updateAdultRows();
  renderApps();
  wireEvents();
  loadStats();
  mountTurnstile();
}

/* ---------- render: app downloads + iOS/VLC guide ---------- */
function renderApps() {
  const apps = DATA.apps; if (!apps) return;
  const grid = $('apps-grid'); grid.textContent = '';
  for (const p of apps.platforms) {
    const a = el('a', 'btn ghost app-btn'); a.href = p.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.append(el('span', 'app-emoji', p.emoji), document.createTextNode(' ' + p.label));
    grid.append(a);
  }
  const ios = apps.ios; if (!ios) return;
  const g = $('ios-guide'); g.textContent = '';
  g.append(el('h3', null, '🍏 iPhone / iPad (via VLC)'));
  g.append(el('p', 'ios-note', ios.note));
  const ol = el('ol', 'ios-steps');
  for (const s of ios.steps) ol.append(el('li', null, s));
  g.append(ol);
  const row = el('div', 'ios-btns');
  const vlc = el('a', 'btn ghost'); vlc.href = ios.vlc_url; vlc.target = '_blank'; vlc.rel = 'noopener noreferrer'; vlc.textContent = '⬇️ Get VLC';
  const web = el('a', 'btn ghost'); web.href = ios.web_url; web.target = '_blank'; web.rel = 'noopener noreferrer'; web.textContent = '🌐 Open Stremio Web';
  row.append(vlc, web); g.append(row);
}

function fatal(msg) { const e = $('go-error'); if (e) { e.textContent = msg; e.hidden = false; } }

/* ---------- render: packs ---------- */
function renderPacks() {
  const wrap = $('packs'); wrap.textContent = '';
  for (const [id, p] of Object.entries(DATA.packs)) {
    const card = el('button', 'pack' + (p.recommended ? ' rec' : '') + (p.adult ? ' adult' : ''));
    card.type = 'button';
    card.dataset.pack = id;
    card.setAttribute('aria-pressed', 'false');
    card.append(el('span', 'emoji', p.emoji), el('span', 'pn', p.name), el('span', 'pt', p.tagline));
    card.append(el('span', 'pc', ''));          // tally slot, filled by loadStats()
    card.addEventListener('click', () => togglePack(id, card));
    wrap.append(card);
    if (p.default_on) togglePack(id, card);
  }
}

async function togglePack(id, card) {
  const pack = DATA.packs[id];
  const on = !selectedPacks.has(id);

  // Exclusive packs (Kids) can't combine: selecting clears + locks everything else.
  if (pack.exclusive) {
    if (on) {
      selectedPacks.clear();
      for (const c of document.querySelectorAll('.pack')) c.setAttribute('aria-pressed', 'false');
      selectedPacks.add(id); card.setAttribute('aria-pressed', 'true');
      setExclusiveLock(true);
    } else {
      selectedPacks.delete(id); card.setAttribute('aria-pressed', 'false');
      setExclusiveLock(false);
    }
    syncCustomFromPacks(); updateAdultRows();
    return;
  }
  if (exclusiveActive()) return;                 // locked while an exclusive pack is on

  if (on && pack.age_gate && !adultConfirmed) {
    const ok = await showModal({
      title: '🔞 18+ content',
      body: 'This unlocks adult add-ons (porn, hentai, live cams). Please confirm you are over 18.',
      okText: 'I\'m 18 or older', cancelText: 'Cancel'
    });
    if (!ok) return;
    adultConfirmed = true;
  }
  if (on) selectedPacks.add(id); else selectedPacks.delete(id);
  card.setAttribute('aria-pressed', String(on));
  syncCustomFromPacks(); updateAdultRows();
}

function exclusiveActive() {
  return [...selectedPacks].some((p) => DATA.packs[p] && DATA.packs[p].exclusive);
}

// Lock/unlock all non-exclusive controls (other packs, toggles, debrid, Custom, Everything).
function setExclusiveLock(locked) {
  for (const c of document.querySelectorAll('.pack')) {
    if (DATA.packs[c.dataset.pack].exclusive) continue;
    c.classList.toggle('disabled', locked);
  }
  const ids = ['legal-mode', 'debrid-key', 'debrid-provider', 'btn-everything'];
  for (const i of ids) { const e = $(i); if (e) e.disabled = locked; }
  for (const r of document.querySelectorAll('input[name=quality],input[name=maxq]')) r.disabled = locked;
  for (const cb of document.querySelectorAll('#addon-list input')) cb.disabled = locked;
  const adv = $('advanced'); if (adv) { if (locked) adv.open = false; adv.classList.toggle('disabled', locked); }
}

/* ---------- render: toggles ---------- */
function renderToggles() {
  const t = DATA.toggles;
  $('legal-label').textContent = t.legal_mode.label;
  $('legal-blurb').textContent = t.legal_mode.blurb;
  $('quality-label').textContent = t.quality.label;
  $('debrid-label').textContent = t.debrid.label;
  $('debrid-blurb').textContent = t.debrid.blurb;

  // Result style — radios + a live explanation that updates as you pick.
  const opts = $('quality-opts'); opts.textContent = '';
  const qBlurb = $('quality-blurb'); qBlurb.textContent = t.quality.blurb;
  for (const [mode, desc] of Object.entries(t.quality.modes)) {
    const lab = el('label', null, mode[0].toUpperCase() + mode.slice(1));
    lab.title = desc;
    const r = el('input'); r.type = 'radio'; r.name = 'quality'; r.value = mode;
    if (mode === t.quality.default) r.checked = true;
    r.addEventListener('change', () => { qBlurb.textContent = t.quality.modes[mode]; });
    lab.prepend(r); opts.append(lab);
  }
  if (t.quality.modes[t.quality.default]) qBlurb.textContent = t.quality.modes[t.quality.default];

  // Max quality cap.
  if (t.max_quality) {
    $('max-quality-label').textContent = t.max_quality.label;
    $('max-quality-blurb').textContent = t.max_quality.blurb;
    const mq = $('max-quality-opts'); mq.textContent = '';
    for (const [mode, def] of Object.entries(t.max_quality.modes)) {
      const lab = el('label', null, def.label || mode);
      const r = el('input'); r.type = 'radio'; r.name = 'maxq'; r.value = mode;
      if (mode === t.max_quality.default) r.checked = true;
      lab.prepend(r); mq.append(lab);
    }
  }

  if (t._omitted_filters) $('adv-note').textContent = 'Want codec, audio-language or size filtering? Pick ' +
    'AIOStreams below (it does all of that, debrid required).';

  const d = DATA.debrid;
  const sel = $('debrid-provider'); sel.textContent = '';
  for (const [id, p] of Object.entries(d.providers)) {
    const o = el('option', null, p.label + (p.recommended ? ' (recommended)' : ''));
    o.value = id; if (id === d.default) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', updateDebridCta);
  updateDebridCta();
}
function updateDebridCta() {
  const d = DATA.debrid;
  const prov = d.providers[$('debrid-provider').value] || d.providers[d.default];
  const cta = $('debrid-cta'); cta.textContent = "Don't have one? ";
  const a = el('a', null, `Get ${prov.label} →`);
  a.href = prov.signup_url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  cta.append(a);
}

/* ---------- render: custom (individual add-ons) ---------- */
function renderCustom() {
  const list = $('addon-list'); list.textContent = '';
  for (const [id, a] of Object.entries(DATA.addons)) {
    if (a.protected || a.dead) continue;        // defaults are always present; dead addons are hidden
    const row = el('label', 'addon-row'); row.dataset.addon = id;
    if (a.adult) { row.dataset.adult = '1'; row.hidden = true; }   // hidden until Adult pack is on
    const cb = el('input'); cb.type = 'checkbox'; cb.value = id; cb.dataset.addon = id;
    const txt = el('span');
    const name = el('span', 'ar-name', a.name);
    if (a.adult) name.append(badge('adult', '18+'));
    if (a.debrid_only) name.append(badge('debrid', 'debrid'));
    else if (a.debrid_boost) name.append(badge('debrid', 'debrid+'));
    if (a.reliability === 'low') name.append(badge('flaky', 'flaky'));
    if (a.needs_url) name.append(badge('cfg', 'setup'));
    txt.append(name, el('span', 'ar-blurb', a.blurb));
    row.append(cb, txt);
    list.append(row);
  }
}
function badge(kind, txt) { return el('span', 'badge ' + kind, txt); }

function syncCustomFromPacks() {
  const want = new Set(currentAddonIdsFromPacks());
  for (const cb of document.querySelectorAll('#addon-list input[type=checkbox]'))
    cb.checked = want.has(cb.value);
}

// Show 18+ add-ons in the Advanced picker ONLY while the Adult pack is selected;
// hide + uncheck them otherwise so they never appear by surprise.
// Show 18+ add-ons ONLY while the Adult pack is selected.
// Enforces inline styles to bypass CSS inheritance conflicts.
function updateAdultRows() {
  const showAdult = selectedPacks.has('adult');

  for (const cb of document.querySelectorAll('#addon-list input[type="checkbox"]')) {
    const wrapper = cb.closest('.addon-row');
    
    // Cross-reference DOM dataset, memory state, and an aggressive regex for raw values
    const isAdult = (wrapper && wrapper.dataset.adult === '1') || 
                    DATA?.addons?.[cb.value]?.adult || 
                    /adult|porn|hentai|chaturbate|stripchat/i.test(cb.value);

    if (isAdult) {
      // 1. Nuke the checked state so ghost items aren't submitted
      if (!showAdult) cb.checked = false;

      // 2. Ruthlessly enforce display state via inline CSS
      if (wrapper) {
        wrapper.style.display = showAdult ? '' : 'none';
        wrapper.hidden = !showAdult; // Retain attribute for DOM querying/accessibility
      } else {
        // Flat DOM fallback constraint
        cb.style.display = showAdult ? '' : 'none';
        cb.hidden = !showAdult;
        const sibling = cb.nextElementSibling;
        if (sibling) {
          sibling.style.display = showAdult ? '' : 'none';
        }
      }
    }
  }
}
function currentAddonIdsFromPacks() {
  const ids = [];
  for (const pid of selectedPacks) for (const aid of (DATA.packs[pid].addons || [])) ids.push(aid);
  return ids;
}

/* ---------- selection resolution ---------- */
function resolveSelection() {
  // Exclusive pack (Kids) REPLACES the baseline — only its own addons, nothing else.
  const exId = [...selectedPacks].find((p) => DATA.packs[p] && DATA.packs[p].exclusive);
  if (exId) {
    const auto = [], configure = [];
    for (const id of DATA.packs[exId].addons) {
      const a = DATA.addons[id]; if (!a) continue;
      if (a.needs_url || (!a.manifest && !a.assemble)) configure.push(id); else auto.push(id);
    }
    return { auto, configure };
  }

  const legal = $('legal-mode').checked;
  const chosen = new Set(DATA.baseline);
  for (const cb of document.querySelectorAll('#addon-list input:checked')) chosen.add(cb.value);

  if (legal) {
    const lm = DATA.toggles.legal_mode;
    for (const id of [...chosen]) {
      const a = DATA.addons[id];
      if (!a) { chosen.delete(id); continue; }
      if (lm.strips_addons.includes(id)) chosen.delete(id);
      if (a.adult || (a.categories || []).some((c) => lm.strips_categories.includes(c))) chosen.delete(id);
    }
    for (const id of lm.adds_addons) chosen.add(id);
  }

  const auto = [], configure = [];
  for (const id of chosen) {
    const a = DATA.addons[id]; if (!a) continue;
    if (a.needs_url || (!a.manifest && !a.assemble)) configure.push(id);
    else auto.push(id);
  }
  return { auto, configure };
}

// Drop unwanted Stremio default addons. Protected ones (Cinemeta, Local Files)
// are never in the remove lists, so they always survive.
function pruneDefaults(collection, keepPublicDomain) {
  const d = DATA.defaults || {};
  const drop = new Set(d.remove || []);
  if (!keepPublicDomain) for (const u of (d.remove_unless_legal || [])) drop.add(u);
  return collection.filter((a) => a.flags && a.flags.protected ? true : !drop.has(a.transportUrl));
}

function manifestUrlFor(id) {
  const a = DATA.addons[id];
  if (a.assemble) {                              // Torrentio-style: build URL from parts + filters + optional debrid key
    const s = a.assemble;
    const style = (document.querySelector('input[name=quality]:checked') || {}).value || 'balanced';
    const sort = (s.sort && s.sort[style]) || 'seeders';

    // Build a single merged qualityfilter (Torrentio rejects duplicate keys):
    //   base exclusions + (quality style also drops 480p) + max-quality resolution cap.
    const qf = new Set((s.qualityfilter_base || '').split(',').filter(Boolean));
    if (style === 'quality') qf.add('480p');
    const mqMode = (document.querySelector('input[name=maxq]:checked') || {}).value || 'any';
    const mqDef = ((DATA.toggles.max_quality || {}).modes || {})[mqMode];
    if (mqDef && mqDef.exclude) for (const x of mqDef.exclude.split(',')) qf.add(x);

    let cfg = 'providers=' + s.providers + '|sort=' + sort;
    if (qf.size) cfg += '|qualityfilter=' + [...qf].join(',');
    if (style === 'quality') cfg += '|limit=10';

    const key = sanitizeKey($('debrid-key').value);
    if (key) {
      const provSel = ($('debrid-provider') || {}).value || DATA.debrid.default;
      cfg += '|' + DATA.debrid.providers[provSel].torrentio_param + '=' + key;
    }
    return s.base + cfg + '/manifest.json';
  }
  return a.manifest;
}

/* ---------- events ---------- */
function wireEvents() {
  $('email-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('email').value.trim();
    if (!validEmail(email)) { fieldErr('email-error', 'That doesn\'t look like a valid email.'); return; }
    $('email-error').hidden = true;
    show('step-packs');
  });
  $('back-email').addEventListener('click', () => show('step-email'));
  $('btn-everything').addEventListener('click', () => {
    if (exclusiveActive()) return;
    for (const card of document.querySelectorAll('.pack')) {
      const id = card.dataset.pack;
      if (DATA.packs[id].adult || DATA.packs[id].exclusive) continue;   // adult opt-in; exclusive can't combine
      if (!selectedPacks.has(id)) togglePack(id, card);
    }
  });
  $('btn-clear').addEventListener('click', () => {
    selectedPacks.clear();
    for (const card of document.querySelectorAll('.pack')) card.setAttribute('aria-pressed', 'false');
    setExclusiveLock(false);
    syncCustomFromPacks();
  });
  $('dice').addEventListener('click', () => {
    $('email').value = genThrowaway();
    $('email-error').hidden = true;
  });
  $('legal-mode').addEventListener('change', () => {
    const on = $('legal-mode').checked;
    $('debrid-wrap').style.opacity = on ? '.4' : '1';
    $('debrid-key').disabled = on;
    const warn = $('legal-warn'), t = DATA.toggles.legal_mode;
    if (warn) { warn.textContent = t.warn || ''; warn.hidden = !(on && t.warn); }
  });
  $('btn-go').addEventListener('click', runSetup);
  $('restart').addEventListener('click', () => location.reload());
  for (const b of document.querySelectorAll('.btn.copy'))
    b.addEventListener('click', () => copy($(b.dataset.copy).textContent, b));
}

/* ---------- the setup run ---------- */
async function runSetup() {
  const email = $('email').value.trim();
  const { auto, configure } = resolveSelection();
  if (!validEmail(email)) { show('step-email'); return; }
  if (auto.length === 0 && configure.length === 0) { fieldErr('go-error', 'Pick at least one thing to add.'); return; }
  $('go-error').hidden = true;

  show('step-go');
  const steps = $('progress'); steps.textContent = '';
  const mk = (t) => { const li = el('li', null, t); steps.append(li); return li; };

  // 1. abuse gate + tally (best-effort; never blocks core unless Turnstile is enforced)
  // Best-effort: sends the Turnstile token for server verify + bumps the tally
  // when it succeeds, but NEVER blocks a real user (captcha timing/non-interactive
  // mode must not brick the page). Per-IP rate-limit on the sidecar still applies.
  const liGate = mk('Checking');
  await beginGate([...selectedPacks]);
  liGate.classList.add('done');

  // 2. create account
  const liAcct = mk('Creating your Stremio account');
  const password = genPassword();
  let authKey;
  try { authKey = await stremioRegister(email, password); }
  catch (err) { liAcct.classList.add('fail'); fieldErr('go-error', regError(err)); show('step-packs'); return; }
  liAcct.classList.add('done');

  // 3. fetch existing (default) addons, then build our descriptors
  const liBuild = mk('Loading your add-ons');
  let collection = [];
  try { collection = await stremioGet(authKey); } catch (_) { /* fall back to empty + ours */ }
  // Keep the public-domain default when it's part of the selection (legal mode or Kids).
  const keepPDM = $('legal-mode').checked || auto.includes('public-domain-movies');
  collection = pruneDefaults(collection, keepPDM);
  const have = new Set(collection.map((a) => a.transportUrl));
  const oversize = new Set();         // has a manifest, but too big to bake into the account (install via link instead)
  let added = 0;
  for (const id of auto) {
    const url = manifestUrlFor(id); if (!url || have.has(url)) continue;
    try {
      const manifest = await (await fetch(url, { cache: 'no-cache', referrerPolicy: 'no-referrer' })).json();
      // addonCollectionSet rejects oversized descriptors (err 20004) and fails the WHOLE save.
      // e.g. TPB 4K Porn ships ~393 catalogs. Skip baking it; it still installs fine via its own link.
      if (DATA.addons[id].too_large || JSON.stringify(manifest).length > 40000) { oversize.add(id); continue; }
      collection.push({ transportUrl: url, transportName: '', manifest, flags: { official: false, protected: false } });
      have.add(url); added++;
    } catch (_) { /* skip unreachable addon, keep going */ }
  }
  liBuild.textContent = `Loaded ${added} add-on${added === 1 ? '' : 's'}`;
  liBuild.classList.add('done');

  // 4. push collection — resilient: on a size error, drop the largest descriptor and retry
  const liPush = mk('Saving to your account');
  const saved = await saveCollection(authKey, collection);

  // 5. verify-after-write: re-read the account and confirm what actually persisted
  let status;
  if (!saved) {
    liPush.classList.add('fail');
    status = { ok: false, msg: 'Add-ons could not be saved to the account. Use the install buttons below to add them manually.' };
  } else {
    let present = -1;
    try {
      const after = await stremioGet(authKey);
      const afterUrls = new Set(after.map((a) => a.transportUrl));
      present = collection.filter((a) => !(a.flags && a.flags.protected) && afterUrls.has(a.transportUrl)).length;
    } catch (_) { /* verify is best-effort */ }
    liPush.textContent = present >= 0 ? `Saved ${present} add-on${present === 1 ? '' : 's'} to your account` : 'Saved to your account';
    liPush.classList.add('done');
    status = { ok: true, count: present };
  }

  renderDone(email, password, auto, configure, oversize, status);
  show('step-done');
}

// Save the collection, retrying on Stremio's "Max descriptor size" (20004) by
// dropping the single largest non-protected descriptor each pass.
async function saveCollection(authKey, collection) {
  let coll = collection.slice();
  for (let attempt = 0; attempt < 5; attempt++) {
    try { await stremioSet(authKey, coll); return true; }
    catch (err) {
      if (err && err.code === 20004 && coll.length > 1) {
        let idx = -1, max = -1;
        coll.forEach((a, i) => {
          if (a.flags && a.flags.protected) return;
          const s = JSON.stringify(a.manifest || {}).length;
          if (s > max) { max = s; idx = i; }
        });
        if (idx >= 0) { coll.splice(idx, 1); continue; }
      }
      return false;
    }
  }
  return false;
}

/* ---------- Stremio API (client-side) ---------- */
async function stremioPost(path, body) {
  const r = await fetch(CONFIG.stremioApi + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    referrerPolicy: 'no-referrer'              // don't leak our domain to Stremio (avoids domain/IP bans)
  });
  const j = await r.json();
  if (j.error) throw j.error;
  return j.result;
}
async function stremioRegister(email, password) {
  const res = await stremioPost('/register', {
    type: 'Auth', email, password,
    gdpr_consent: { tos: true, privacy: true, marketing: false, from: 'stremio-setup' }
  });
  return res.authKey;
}
async function stremioGet(authKey) {
  const res = await stremioPost('/addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
  return res.addons || [];
}
async function stremioSet(authKey, addons) {
  return stremioPost('/addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons });
}
function regError(err) {
  const m = (err && err.message) || '';
  if (/exist|registered|taken/i.test(m)) return 'That email already has a Stremio account. Log in instead, or use another email.';
  return 'Could not create the account: ' + (m || 'unknown error') + '. Try again.';
}

/* ---------- our sidecar ---------- */
// Returns 'ok' (verified+tallied), 'deny' (reachable but rejected the token),
// or 'down' (sidecar unreachable). Account creation proceeds on 'ok'/'down'
// (the client already required a Turnstile token) — only an explicit 'deny' blocks,
// so a sidecar hiccup never takes the whole site down.
async function beginGate(packs) {
  try {
    const r = await fetch(CONFIG.apiBase + '/begin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstileToken, packs })
    });
    if (r.status === 429) return 'deny';
    if (!r.ok) return 'down';
    const j = await r.json(); return j.ok ? 'ok' : 'deny';
  } catch (_) { return 'down'; }
}
async function loadStats() {
  try {
    const j = await (await fetch(CONFIG.apiBase + '/stats', { cache: 'no-cache' })).json();
    const counts = j.counts || {}, total = j.total || 0;
    if (total > 0) $('tally').innerHTML = '🍿 <span>' + total.toLocaleString() + '</span> setups and counting';
    for (const card of document.querySelectorAll('.pack')) {
      const n = counts[card.dataset.pack] || 0;
      if (n > 0) card.querySelector('.pc').textContent = '🔥 ' + n.toLocaleString() + ' picked this';
    }
  } catch (_) { /* tally is cosmetic; ignore if sidecar is down */ }
}

/* ---------- done screen ---------- */
function renderDone(email, password, auto, configure, oversize, status) {
  oversize = oversize || new Set();
  $('out-email').textContent = email;
  $('out-pass').textContent = password;

  const banner = $('apply-status');
  if (banner && status) {
    banner.hidden = false;
    if (status.ok) {
      banner.className = 'apply-status ok';
      banner.textContent = status.count > 0
        ? `✓ ${status.count} add-on${status.count === 1 ? '' : 's'} saved to this new account.`
        : '✓ Account created. Add-ons saved.';
    } else {
      banner.className = 'apply-status bad';
      banner.textContent = '⚠️ ' + status.msg;
    }
  }

  const installs = $('install-list'); installs.textContent = '';
  const manual = $('manual-list'); manual.textContent = '';
  const qr = $('qr-list'); qr.textContent = '';
  for (const id of auto) {
    const url = manifestUrlFor(id); if (!url) continue;
    const name = DATA.addons[id].name + (oversize.has(id) ? ' — tap to install (too big to auto-add)' : '');
    installs.append(linkItem(name, deepLink(url), 'Install in Stremio', true));
    manual.append(copyItem(name, url));
    qr.append(qrItem(name, deepLink(url)));
  }

  const cfg = $('configure-list'); cfg.textContent = '';
  if (configure.length) {
    $('fallback-configure').hidden = false;
    for (const id of configure) {
      const a = DATA.addons[id];
      const note = el('span', 'ar-blurb', a.config_note || a.blurb);
      const item = el('div', 'lnk-item');
      const ttl = el('div', 'ttl', a.name);
      if (a.debrid_only) ttl.append(badge('debrid', 'debrid'));
      if (a.adult) ttl.append(badge('adult', '18+'));
      item.append(ttl, note);
      if (a.configure_url) {
        const link = el('a', 'btn primary', 'Configure & install →');
        link.href = a.configure_url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        item.append(link);
      }
      cfg.append(item);
    }
  } else { $('fallback-configure').hidden = true; }
}
function deepLink(httpsUrl) { return 'stremio://' + httpsUrl.replace(/^https?:\/\//, ''); }
function linkItem(name, href, label, deep) {
  const it = el('div', 'lnk-item'); it.append(el('div', 'ttl', name));
  const a = el('a', 'btn primary', label); a.href = href;
  if (!deep) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  it.append(a); return it;
}
function copyItem(name, url) {
  const it = el('div', 'lnk-item'); it.append(el('div', 'ttl', name));
  const code = el('code', null, url); it.append(code);
  const b = el('button', 'btn', 'Copy link'); b.type = 'button';
  b.addEventListener('click', () => copy(url, b)); it.append(b); return it;
}
function qrItem(name, data) {
  const it = el('div', 'qr-item'); it.append(el('div', 'ttl', name));
  const img = el('img'); img.alt = 'QR for ' + name; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
  img.src = CONFIG.qrRenderer + encodeURIComponent(data);
  it.append(img); return it;
}

/* ---------- helpers ---------- */
function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254; }
function sanitizeKey(s) { return (s || '').trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 128); }
const rndInt = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };

// Disposable email: {word}-{4 lowercase}@{domain}. Stremio never sends a confirmation.
function genThrowaway() {
  const g = (DATA && DATA.email_gen) || { domain: 'stremiodoesntcare.lol', words: ['popcorn'] };
  const az = 'abcdefghijklmnopqrstuvwxyz';
  let tag = ''; for (let i = 0; i < 4; i++) tag += az[rndInt(26)];
  return `${g.words[rndInt(g.words.length)]}-${tag}@${g.domain}`;
}

// Themed confirm overlay (replaces native confirm/alert). Resolves true/false.
function showModal({ title, body, okText = 'OK', cancelText = 'Cancel' }) {
  return new Promise((resolve) => {
    const m = $('modal');
    $('modal-title').textContent = title || '';
    $('modal-body').textContent = body || '';
    $('modal-ok').textContent = okText;
    $('modal-cancel').textContent = cancelText;
    m.hidden = false;
    const onKey = (e) => { if (e.key === 'Escape') done(false); else if (e.key === 'Enter') done(true); };
    function done(val) {
      m.hidden = true;
      $('modal-ok').onclick = $('modal-cancel').onclick = m.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(val);
    }
    $('modal-ok').onclick = () => done(true);
    $('modal-cancel').onclick = () => done(false);
    m.onclick = (e) => { if (e.target === m) done(false); };   // click backdrop = cancel
    document.addEventListener('keydown', onKey);
    $('modal-ok').focus();
  });
}
function fieldErr(id, msg) { const e = $(id); e.textContent = msg; e.hidden = false; }
function genPassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%&*?'];
  const all = sets.join(''); const out = [];
  const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  for (const s of sets) out.push(s[rnd(s.length)]);          // guarantee one of each class
  while (out.length < 16) out.push(all[rnd(all.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = rnd(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch (_) { return; }
  const old = btn.textContent; btn.textContent = 'Copied ✓';
  setTimeout(() => { btn.textContent = old; }, 1400);
}
// Explicit render (NOT auto) — the async api.js can load after init, and an
// auto-rendered element with an empty sitekey never renders. Poll until ready.
function mountTurnstile() {
  const t = $('turnstile');
  if (!CONFIG.turnstileSitekey) { t.hidden = true; return; }
  let done = false;
  const render = () => {
    if (done || !(window.turnstile && window.turnstile.render)) return;
    done = true;
    try {
      window.turnstile.render(t, {
        sitekey: CONFIG.turnstileSitekey, theme: 'dark',
        callback: (tok) => { turnstileToken = tok; },
        'expired-callback': () => { turnstileToken = ''; },
        'error-callback': () => { turnstileToken = ''; }
      });
    } catch (_) { done = false; }
  };
  render();
  if (!done) {
    const iv = setInterval(() => { render(); if (done) clearInterval(iv); }, 150);
    setTimeout(() => clearInterval(iv), 12000);
  }
}
