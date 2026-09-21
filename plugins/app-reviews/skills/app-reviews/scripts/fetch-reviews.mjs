// Fetch recent reviews for one app from the App Store and Google Play.
//
//   node fetch-reviews.mjs [days] [--ios-only]      default: 30 days
//
// The app is defined in app.json in the folder you are working in — copy
// app.example.json and edit it. Nothing about any particular app lives here.
//
// Writes raw JSON per store plus a combined UTF-8 CSV into ./out, also in the
// folder you are working in. workdir.mjs explains why that is not beside this file.

import fs from 'node:fs/promises';
import path from 'node:path';
import { WORK, OUT, ensureOut, readWorkConfig, loadPlayScraper } from './workdir.mjs';

// Loaded rather than imported so a missing dependency produces an instruction,
// not a stack trace — and resolved from the work directory first, because that
// is where `npm install` was run.
const gplay = await loadPlayScraper();
if (!gplay) {
  console.error([
    '',
    'Missing dependency: google-play-scraper',
    '',
    '  Run this once, in the folder you are working in:',
    `    cd "${WORK}"`,
    '    npm install google-play-scraper',
    '',
    '  It is the only dependency this pipeline has.',
    '',
  ].join(String.fromCharCode(10)));
  process.exit(1);
}

const args = process.argv.slice(2);
// --ios-only refetches just the App Store and reuses the saved Play pull,
// so fixing an iOS bug doesn't mean re-scraping 34k Android reviews.
const IOS_ONLY = args.includes('--ios-only');
const DAYS = Number(args.find((a) => !a.startsWith('--')) ?? 30);

// --- The app ---------------------------------------------------------------
const CFG = await readWorkConfig('app.json', 'scripts/app.example.json');
for (const k of ['slug', 'androidId', 'country']) {
  if (!CFG[k]) throw new Error(`app.json is missing "${k}".`);
}

const SLUG = CFG.slug;                       // used in every output filename
const IOS_ID = CFG.iosId ?? null;            // null = Play only, which is fine
const IOS_COUNTRY = CFG.iosCountry ?? CFG.country;
const ANDROID_ID = CFG.androidId;
const ANDROID_COUNTRY = CFG.country;
// Volume per month decides this. ~2,500 reviews/month at 150 a page means a
// 6-month pull needs roughly 100 pages; cap high with headroom.
const MAX_PLAY_PAGES = CFG.maxPlayPages ?? 250;
// Play's reviews endpoint partitions by the reviewer's device LOCALE, not by
// the language of the review text, and each locale is a separate stream with
// its own ids. Asking only in the app's main language silently misses reviews
// in that language written on phones set to another locale. Two or three
// locales carry almost all the volume; the rest are shallow tails that stop
// after one page, so sweeping them is cheap insurance. Keep the list long.
const ANDROID_LANGS = CFG.androidLangs ?? ['en', 'ar', 'fr', 'de', 'tr', 'it', 'es', 'ru',
  'nl', 'pt', 'el', 'id', 'ur', 'fa', 'hi', 'zh', 'ja', 'ko', 'pl', 'ro', 'sv', 'da',
  'cs', 'hu', 'he', 'uk', 'th', 'vi', 'ms', 'bn'];

const now = new Date();
const cutoff = new Date(now.getTime() - DAYS * 24 * 60 * 60 * 1000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- App Store -------------------------------------------------------------
// Apple's legacy customer-reviews RSS. Stops at 500 reviews at most (10 pages
// x 50), sometimes far fewer, and covers one storefront. The limit is on COUNT,
// not time: a busy app's 500 can cover three days, so the date range actually
// obtained must always be reported.
// Some URL shapes serve a cached EMPTY feed instead of an error, and which
// shape breaks differs by page: page=1 fails with sortby, page=2 fails with
// it too but works without. So try several shapes and take the first that
// returns rows. An empty result here means "try another shape", not "no data".
function iosUrlForms(page) {
  const base = `https://itunes.apple.com/${IOS_COUNTRY}/rss/customerreviews`;
  return [
    `${base}/id=${IOS_ID}/page=${page}/sortby=mostrecent/json`,
    `${base}/page=${page}/id=${IOS_ID}/json`,
    `${base}/page=${page}/id=${IOS_ID}/sortby=mostrecent/json`,
    `${base}/id=${IOS_ID}/sortby=mostrecent/json`
  ];
}

async function fetchIos() {
  const all = [];
  const seen = new Set();
  let stopped = false;

  for (let page = 1; page <= 10 && !stopped; page++) {
    let entries = [];
    for (const url of iosUrlForms(page)) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        entries = json?.feed?.entry ? [].concat(json.feed.entry) : [];
        if (entries.filter((e) => e['im:rating']).some((e) => !seen.has(e.id?.label))) break;
        entries = [];
      } catch (err) {
        console.error(`  ios page ${page}: ${err.message}`);
      }
      await sleep(600);
    }
    if (!entries.length) {
      console.log(`  ios page ${page}: no new rows from any URL shape, stopping`);
      break;
    }

    for (const e of entries) {
      // The first entry of page 1 is the app itself, not a review.
      if (!e['im:rating']) continue;
      const id = e.id?.label;
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const date = new Date(e.updated?.label);
      const review = {
        store: 'App Store',
        review_id: id,
        date: date.toISOString(),
        rating: Number(e['im:rating'].label),
        title: e.title?.label ?? '',
        body: e.content?.label ?? '',
        author: e.author?.name?.label ?? '',
        app_version: e['im:version']?.label ?? '',
        thumbs_up: e['im:voteSum']?.label ?? '',
        reply_date: '',
        reply_text: '',
        url: e.author?.uri?.label ?? ''
      };
      all.push(review);
      if (date < cutoff) stopped = true; // sorted newest-first
    }
    console.log(`  ios page ${page}: ${entries.length} entries (${all.length} total)`);
    await sleep(700);
  }
  return all;
}

// --- Google Play -----------------------------------------------------------
// Reviews are language-scoped, so sweep Arabic and English and dedupe by id.
async function fetchAndroidLang(lang) {
  const out = [];
  let token = undefined;

  for (let page = 0; page < MAX_PLAY_PAGES; page++) {
    let res;
    try {
      res = await gplay.reviews({
        appId: ANDROID_ID,
        lang,
        country: ANDROID_COUNTRY,
        sort: gplay.sort.NEWEST,
        num: 150,
        paginate: true,
        nextPaginationToken: token
      });
    } catch (err) {
      console.error(`  android[${lang}] page ${page}: ${err.message}`);
      break;
    }

    const batch = res?.data ?? [];
    if (!batch.length) break;

    let oldest = null;
    for (const r of batch) {
      const date = new Date(r.date);
      oldest = date;
      out.push({
        store: 'Google Play',
        review_id: r.id,
        date: date.toISOString(),
        rating: r.score,
        title: r.title ?? '',
        body: r.text ?? '',
        author: r.userName ?? '',
        app_version: r.version ?? '',
        thumbs_up: r.thumbsUp ?? 0,
        reply_date: r.replyDate ? new Date(r.replyDate).toISOString() : '',
        reply_text: r.replyText ?? '',
        url: r.url ?? ''
      });
    }
    // A big language runs for many minutes, and before this line it printed
    // nothing until it finished, so a first-time user watched a silent terminal
    // and decided it had hung. Every 20 pages is roughly every half minute.
    if ((page + 1) % 20 === 0) {
      console.log(`    ${lang}: ${out.length.toLocaleString()} so far, back to ${oldest.toISOString().slice(0, 10)}` +
        ` (stops at ${cutoff.toISOString().slice(0, 10)})`);
    }
    token = res.nextPaginationToken;
    if (!token) break;
    if (oldest && oldest < cutoff) break; // sorted newest-first
    await sleep(700);
  }
  return out;
}

async function fetchAndroid() {
  const seen = new Set();
  const all = [];
  for (const lang of ANDROID_LANGS) {
    const rows = await fetchAndroidLang(lang);
    let added = 0;
    let inWindow = 0;
    for (const r of rows) {
      if (seen.has(r.review_id)) continue;
      seen.add(r.review_id);
      all.push(r);
      added++;
      if (new Date(r.date) >= cutoff) inWindow++;
    }
    console.log(`  ${lang.padEnd(4)} ${String(rows.length).padStart(5)} fetched  ${String(added).padStart(5)} new  ${String(inWindow).padStart(5)} in window`);
  }
  return all;
}

// --- Output ----------------------------------------------------------------
const COLUMNS = ['store', 'review_id', 'date', 'rating', 'title', 'body', 'author',
  'app_version', 'thumbs_up', 'reply_date', 'reply_text', 'url'];

function toCsv(rows) {
  const esc = (v) => {
    const s = String(v ?? '').replace(/\r\n|\r|\n/g, ' ').trim();
    return /[",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [COLUMNS.join(',')];
  for (const r of rows) lines.push(COLUMNS.map((c) => esc(r[c])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n'; // BOM so Excel reads Arabic
}

console.log(`${CFG.name ?? SLUG} reviews since ${cutoff.toISOString().slice(0, 10)} (last ${DAYS} days)`);
// Say where the output is going before spending twenty minutes producing it.
console.log(`Writing to ${OUT}\n`);
await ensureOut();

let ios = [];
if (IOS_ID) {
  console.log('App Store:');
  ios = await fetchIos();
} else {
  console.log('App Store: no iosId in app.json, skipping.');
}
let android;
if (IOS_ONLY) {
  android = JSON.parse(await fs.readFile(path.join(OUT, 'raw-google-play.json'), 'utf8'));
  console.log(`\nGoogle Play: reusing saved pull (${android.length} reviews)`);
} else {
  console.log('\nGoogle Play:');
  android = await fetchAndroid();
}

const inRange = [...ios, ...android]
  .filter((r) => new Date(r.date) >= cutoff)
  .sort((a, b) => b.date.localeCompare(a.date));

const stamp = `${cutoff.toISOString().slice(0, 10)}_to_${now.toISOString().slice(0, 10)}`;
await fs.writeFile(path.join(OUT, 'raw-app-store.json'), JSON.stringify(ios, null, 2), 'utf8');
if (!IOS_ONLY) await fs.writeFile(path.join(OUT, 'raw-google-play.json'), JSON.stringify(android, null, 2), 'utf8');
await fs.writeFile(path.join(OUT, `${SLUG}-reviews_${stamp}.json`), JSON.stringify(inRange, null, 2), 'utf8');
await fs.writeFile(path.join(OUT, `${SLUG}-reviews_${stamp}.csv`), toCsv(inRange), 'utf8');

const iosIn = inRange.filter((r) => r.store === 'App Store');
const andIn = inRange.filter((r) => r.store === 'Google Play');
const avg = (a) => (a.length ? (a.reduce((s, r) => s + r.rating, 0) / a.length).toFixed(2) : 'n/a');

console.log(`\nFetched: ${ios.length} App Store, ${android.length} Google Play`);
console.log(`In range (>= ${cutoff.toISOString().slice(0, 10)}): ${inRange.length}`);
console.log(`  App Store   ${iosIn.length}  avg ${avg(iosIn)}`);
console.log(`  Google Play ${andIn.length}  avg ${avg(andIn)}`);
console.log(`  Overall     ${inRange.length}  avg ${avg(inRange)}`);
// Apple's cap is on how many, not how far back, so say what stretch of time the
// App Store numbers actually describe. Duolingo's 500 covered three days of a
// 180-day window; reported as "App Store, last 180 days" that is simply false.
if (iosIn.length) {
  const dates = iosIn.map((r) => r.date).sort();
  const spanDays = Math.max(1, Math.round((Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 86_400_000));
  console.log(`\nApp Store covers ${dates[0].slice(0, 10)} to ${dates.at(-1).slice(0, 10)}: ${spanDays} of the ${DAYS} days asked for.`);
  if (spanDays < DAYS / 10) {
    console.log('  Apple stops at 500 reviews, so for this app they cover only that stretch. Report the');
    console.log('  App Store numbers as describing those days, and never compare them with Play over time.');
  }
}
console.log(`\nWrote ${path.join(OUT, `${SLUG}-reviews_${stamp}.csv`)}`);
