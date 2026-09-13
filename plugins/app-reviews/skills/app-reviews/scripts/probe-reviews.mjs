// Search reviews for areas YOU name, and report the count for each — including
// zero.
//
//   node probe-reviews.mjs                 # uses areas.json
//   node probe-reviews.mjs my-areas.json   # any other area file
//
// Why this exists, and why it is not clustering:
//
//   cluster-reviews.mjs answers "what is big in here?" It sorts every review
//   into k groups, so a theme smaller than about one k-th of the corpus can
//   never win a slot and is silently absorbed into its nearest neighbour. That
//   is not a bug in the clustering; it is what clustering is.
//
//   This file answers the other question: "is X in here at all?" You list the
//   areas your app has, it searches for each one and reports what it found.
//   An area with 0 matches is printed as loudly as one with 500, because
//   "we looked and found none" and "we cannot see this" are different answers
//   and a blank screen looks identical for both.
//
// The honest-answer rule: every count is shown next to the words that produced
// it and real examples of each, so a wrong match is visible instead of
// believable. This was written after a probe for "font" complaints returned
// 192 hits, all of them wrong: خط means "phone line" in Egyptian Arabic, not
// "font". The number was clean, plausible and false.
//
// Nothing here knows it is looking at a telco app. Everything app-specific
// lives in the area file.

import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const MIN_BODY_CHARS = 30; // same cut as cluster-reviews.mjs: below this it is a rating-prompt tap
const SAMPLES_PER_TERM = 3;
const SAMPLES_PER_AREA = 8;

const ROOT = import.meta.dirname;
const OUT = path.join(ROOT, 'out');

// --- Text normalisation ----------------------------------------------------
// Identical to cluster-reviews.mjs on purpose. If the two disagreed, a review
// could land in a cluster but not in the area that describes that cluster, and
// the two outputs would quietly contradict each other.
const DIACRITICS = /[ً-ٰٟـ]/g;

function normalize(text) {
  return String(text ?? '')
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// --- Matching --------------------------------------------------------------
// Arabic glues ال / و / ب / ل onto the front of a word and ها / هم / ات onto
// the back, so a plain substring search either misses "بالتطبيق" or, worse,
// finds "خط" inside "الخطأ". Both failures are silent. So a term matches only
// at a word edge, allowing those affixes and nothing else.
const AFFIX_PREFIX = '(?:وال|فال|بال|كال|لل|ال|و|ف|ب|ك|ل)?';
const AFFIX_SUFFIX = '(?:كم|هم|ها|نا|ين|ون|ات|ان|يه|ه|ي|ك)?';
const ESCAPE = /[.*+?^${}()|[\]\\]/g;

function buildMatcher(rawTerm) {
  const term = String(rawTerm).trim();
  // Escape hatch: an area file can supply a raw regex when the affix rules get
  // in the way. Deliberately explicit — you have to ask for it.
  if (term.startsWith('re:')) {
    return { source: term, re: new RegExp(term.slice(3), 'iu') };
  }
  let body = normalize(term);
  // A trailing * means "and whatever follows": "navigat*" catches navigation
  // and navigate. Opt-in rather than automatic, because an automatic wildcard
  // makes "ads" quietly match "adsense".
  const wildcard = body.endsWith('*');
  if (wildcard) body = body.slice(0, -1).trim();
  // "الواجهه" and "واجهه" should behave the same, since the prefix group below
  // puts the ال back as optional.
  if (/^ال./u.test(body) && body.length > 4) body = body.slice(2);
  const escaped = body.replace(ESCAPE, '\\$&');
  const tail = wildcard ? '[\\p{L}]*' : '';
  const re = /[؀-ۿ]/u.test(body)
    ? new RegExp(`(?<![\\p{L}\\p{N}])${AFFIX_PREFIX}${escaped}${tail}${AFFIX_SUFFIX}(?![\\p{L}\\p{N}])`, 'iu')
    : new RegExp(`(?<![\\p{L}\\p{N}])${escaped}${tail}(?![\\p{L}\\p{N}])`, 'iu');
  return { source: term, re };
}

// --- Load ------------------------------------------------------------------
const areaFile = args.find((a) => a.endsWith('.json')) ?? 'areas.json';
const config = JSON.parse(await fs.readFile(path.join(ROOT, areaFile), 'utf8'));
if (!Array.isArray(config.areas) || !config.areas.length) {
  throw new Error(`${areaFile} has no "areas" array.`);
}

// Widest window, not newest name — "07-09" sorts after "02-10", so sorting by
// filename picks the 30-day pull over the 6-month one. The app-name part of
// the pattern is loose so this works on any app's output, not just this one.
const files = (await fs.readdir(OUT))
  .map((f) => f.match(/^(.+)-reviews_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})\.json$/))
  .filter(Boolean)
  .map((m) => ({ file: m[0], span: Date.parse(m[3]) - Date.parse(m[2]), end: m[3] }))
  .sort((a, b) => b.span - a.span || b.end.localeCompare(a.end));
if (!files.length) throw new Error('No combined review file in out/. Run fetch-reviews.mjs first.');
const source = args.find((a) => /-reviews_.*\.json$/.test(a)) ?? files[0].file;

const all = JSON.parse(await fs.readFile(path.join(OUT, source), 'utf8'));
const docs = all
  .map((r) => ({ ...r, text: `${r.title ?? ''} ${r.body ?? ''}`.trim() }))
  .filter((r) => r.text.length > MIN_BODY_CHARS)
  .map((r) => ({ ...r, norm: normalize(r.text) }));

console.log(`Source: ${source}`);
console.log(`Reviews: ${all.length} total, ${docs.length} substantive (over ${MIN_BODY_CHARS} chars)`);
console.log(`Areas file: ${areaFile} (${config.areas.length} areas)\n`);

// --- Version comparison ----------------------------------------------------
// The strongest thing review data can do on its own: compare people on an old
// build against people on a new build. Version and calendar time are normally
// entangled, so a rise in complaints could be the release or could be the
// month. Splitting on version breaks the tie. Optional — an app with no known
// break version just leaves splitVersion out.
const splitVersion = config.splitVersion ?? null;
const versionKey = (v) => String(v).split('.').map(Number);
function compareVersions(a, b) {
  const x = versionKey(a);
  const y = versionKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}
const side = (r) => {
  if (!splitVersion || !r.app_version || !/^\d/.test(r.app_version)) return null;
  return compareVersions(r.app_version, splitVersion) < 0 ? 'before' : 'after';
};

// --- Stats helpers ---------------------------------------------------------
function summarise(rows) {
  if (!rows.length) return { n: 0, avg: null, oneStar: null };
  const sum = rows.reduce((s, r) => s + r.rating, 0);
  return {
    n: rows.length,
    avg: +(sum / rows.length).toFixed(2),
    oneStar: +(rows.filter((r) => r.rating === 1).length / rows.length).toFixed(3),
  };
}

function byMonth(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = r.date.slice(0, 7);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort().map(([month, count]) => ({ month, count }));
}

const sample = (r) => ({
  rating: r.rating,
  store: r.store,
  version: r.app_version ?? null,
  date: r.date.slice(0, 10),
  text: r.text.replace(/\s+/g, ' ').slice(0, 400),
});

// --- Run each area ---------------------------------------------------------
const results = [];
const matchedAny = new Set();

for (const area of config.areas) {
  const terms = (area.terms ?? []).map(buildMatcher);
  const excludes = (area.exclude ?? []).map(buildMatcher);

  const perTerm = [];
  const hits = new Map(); // review_id -> review, deduped across terms

  for (const t of terms) {
    const rows = docs.filter((r) => t.re.test(r.norm));
    const kept = rows.filter((r) => !excludes.some((x) => x.re.test(r.norm)));
    perTerm.push({
      term: t.source,
      hits: kept.length,
      excluded: rows.length - kept.length,
      // Examples per term, not just per area. This is the line of defence
      // against a confident wrong number: you read three and see immediately
      // that the word does not mean what you assumed.
      samples: kept.slice(0, SAMPLES_PER_TERM).map(sample),
    });
    for (const r of kept) hits.set(r.review_id, r);
  }

  const rows = [...hits.values()];
  for (const r of rows) matchedAny.add(r.review_id);

  const versions = splitVersion
    ? {
        splitVersion,
        before: summarise(rows.filter((r) => side(r) === 'before')),
        after: summarise(rows.filter((r) => side(r) === 'after')),
      }
    : null;

  results.push({
    name: area.name,
    kind: area.kind ?? 'area',
    // The join key to axis-a-codebook.json. Null where clustering never produced
    // an equivalent — which is itself worth seeing.
    codebookArea: area.codebookArea ?? null,
    note: area.note ?? null,
    ...summarise(rows),
    share: +(rows.length / docs.length).toFixed(4),
    ios: rows.filter((r) => r.store === 'App Store').length,
    months: byMonth(rows),
    versions,
    terms: perTerm.sort((a, b) => b.hits - a.hits),
    // Longest first: a 300-character review says more about what the area
    // actually is than the shortest one that happened to match.
    samples: rows
      .slice()
      .sort((a, b) => b.text.length - a.text.length)
      .slice(0, SAMPLES_PER_AREA)
      .map(sample),
  });
}

// How many reviews matched more than one area. High overlap is not wrong, but
// it means the areas are not cleanly separated and counts cannot be added up.
const areaOf = new Map();
for (const [i, area] of config.areas.entries()) {
  const terms = (area.terms ?? []).map(buildMatcher);
  const excludes = (area.exclude ?? []).map(buildMatcher);
  for (const r of docs) {
    if (!terms.some((t) => t.re.test(r.norm))) continue;
    if (excludes.some((x) => x.re.test(r.norm))) continue;
    areaOf.set(r.review_id, (areaOf.get(r.review_id) ?? 0) + 1);
  }
  void i;
}
const overlapping = [...areaOf.values()].filter((n) => n > 1).length;

const coverage = {
  substantive: docs.length,
  matched: matchedAny.size,
  unmatched: docs.length - matchedAny.size,
  matchedShare: +(matchedAny.size / docs.length).toFixed(3),
  overlapping,
};

// --- Report ----------------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

console.log(pad('AREA', 34) + num('FOUND', 6) + num('SHARE', 8) + num('SCORE', 7) + num('1STAR', 7));
console.log('-'.repeat(62));
for (const a of [...results].sort((x, y) => y.n - x.n)) {
  console.log(
    pad(a.name.slice(0, 33), 34) +
      num(a.n, 6) +
      num((100 * a.share).toFixed(1) + '%', 8) +
      num(a.avg ?? '—', 7) +
      num(a.oneStar === null ? '—' : Math.round(100 * a.oneStar) + '%', 7),
  );
}

const empty = results.filter((a) => a.n === 0);
if (empty.length) {
  console.log('\nFOUND NOTHING (a result, not a failure):');
  for (const a of empty) console.log(`  ${a.name} — searched ${a.terms.length} words, 0 matches`);
}

// A term that fires on nothing is usually a wrong guess at the local word, not
// proof the topic is absent. Worth seeing, because it is the difference
// between "not here" and "I asked in the wrong language".
const deadTerms = results.flatMap((a) => a.terms.filter((t) => t.hits === 0).map((t) => `${a.name}: "${t.term}"`));
if (deadTerms.length) {
  console.log(`\n${deadTerms.length} search words matched nothing at all:`);
  for (const t of deadTerms.slice(0, 20)) console.log(`  ${t}`);
  if (deadTerms.length > 20) console.log(`  …and ${deadTerms.length - 20} more`);
}

console.log(
  `\nCoverage: ${coverage.matched} of ${coverage.substantive} substantive reviews matched at least one area ` +
    `(${Math.round(100 * coverage.matchedShare)}%). ${coverage.unmatched} matched none.`,
);
console.log(`${overlapping} reviews matched more than one area, so area counts overlap and must not be summed.`);

const payload = {
  generated: new Date().toISOString(),
  source,
  areaFile,
  minBodyChars: MIN_BODY_CHARS,
  splitVersion,
  coverage,
  areas: results,
};

await fs.writeFile(path.join(OUT, 'area-probe.json'), JSON.stringify(payload, null, 2));

// --- Verification page -----------------------------------------------------
// Embedded, not fetched: a page that fetched its data would show a blank
// screen when opened from disk by double-click, which is how it gets opened.

// The page template may sit beside this script or in ../templates when the
// scripts are installed as a skill. Try both rather than making the caller care.
async function readTemplate(name) {
  for (const dir of [import.meta.dirname, path.join(import.meta.dirname, "..", "templates")]) {
    try { return await fs.readFile(path.join(dir, name), "utf8"); } catch { /* try next */ }
  }
  throw new Error(`Cannot find ${name} beside the script or in ../templates.`);
}

const template = await readTemplate('probe-page.html');
await fs.writeFile(
  path.join(OUT, 'area-probe.html'),
  template.replace('/*__DATA__*/null', JSON.stringify(payload)),
);

console.log('\nWrote out/area-probe.json and out/area-probe.html');
console.log('Open out/area-probe.html and check the matched words before trusting any number.');
