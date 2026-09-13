// Every area, broken down by app version.
//
//   node version-areas.mjs                          # areas.json, rolled up to release trains
//   node version-areas.mjs areas-product-areas.json
//   node version-areas.mjs --parts 3                # individual builds, not trains
//   node version-areas.mjs --min 15                 # smaller cells, noisier rates
//
// --parts controls how far the version is cut before grouping. This app ships
// 2026.<month>.<build>, so --parts 2 gives one column per monthly release train
// and --parts 3 gives one per build. Trains are the default because builds
// scatter 6,809 reviews across 26 columns and nearly every cell falls under the
// minimum — a table that is technically finer and practically unreadable.
//
// Why this and not the before/after split in probe-reviews.mjs. That split answers
// "did this area get worse at the known break version?" — one number, already
// decided where the break is. This answers the open question: *which* version, and
// does the area move with the app or independently of it. An area that steps down
// at the same build as everything else was broken by that build. An area that
// drifts on its own has a cause the release does not explain.
//
// Two things this file refuses to do, both of which produce confident nonsense:
//
//   1. A rate on a handful of reviews. 136 distinct versions appear in this
//      corpus and most carry under ten written reviews. An average of 1.00 on
//      three reviews is not "the worst version" — it is three people. Cells under
//      --min are counted and shown as a bare n, never as a score.
//   2. Sorting versions as strings. "2026.10.1" sorts before "2026.4.1"
//      alphabetically, which would silently reverse the timeline and reverse the
//      finding with it. Version parts are compared as numbers.
//
// The normalisation and matcher are copied verbatim from probe-reviews.mjs, the
// same way cross-areas.mjs copies them. Change one, change all of them.

import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const MIN_BODY_CHARS = 30;
const minIdx = args.indexOf('--min');
const MIN_CELL = minIdx >= 0 ? Number(args[minIdx + 1]) : 20;
const partsIdx = args.indexOf('--parts');
const PARTS = partsIdx >= 0 ? Number(args[partsIdx + 1]) : 2;
const ROOT = import.meta.dirname;
const OUT = path.join(ROOT, 'out');

// --- Copied verbatim from probe-reviews.mjs --------------------------------
const DIACRITICS = /[ً-ْٰٟـ]/g;

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

const AFFIX_PREFIX = '(?:وال|فال|بال|كال|لل|ال|و|ف|ب|ك|ل)?';
const AFFIX_SUFFIX = '(?:كم|هم|ها|نا|ين|ون|ات|ان|يه|ه|ي|ك)?';
const ESCAPE = /[.*+?^${}()|[\]\\]/g;

function buildMatcher(rawTerm) {
  const term = String(rawTerm).trim();
  if (term.startsWith('re:')) return { source: term, re: new RegExp(term.slice(3), 'iu') };
  let body = normalize(term);
  const wildcard = body.endsWith('*');
  if (wildcard) body = body.slice(0, -1).trim();
  if (/^ال./u.test(body) && body.length > 4) body = body.slice(2);
  const escaped = body.replace(ESCAPE, '\\$&');
  const tail = wildcard ? '[\\p{L}]*' : '';
  const re = /[؀-ۿ]/u.test(body)
    ? new RegExp(`(?<![\\p{L}\\p{N}])${AFFIX_PREFIX}${escaped}${tail}${AFFIX_SUFFIX}(?![\\p{L}\\p{N}])`, 'iu')
    : new RegExp(`(?<![\\p{L}\\p{N}])${escaped}${tail}(?![\\p{L}\\p{N}])`, 'iu');
  return { source: term, re };
}
// --- end copied block ------------------------------------------------------

// Numeric, part by part. Missing parts count as 0 so "2026.4" precedes "2026.4.1".
function compareVersions(a, b) {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// --- Load ------------------------------------------------------------------
const areaFile = args.find((a) => a.endsWith('.json')) ?? 'areas.json';
const config = JSON.parse(await fs.readFile(path.join(ROOT, areaFile), 'utf8'));

const files = (await fs.readdir(OUT))
  .map((f) => f.match(/^(.+)-reviews_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})\.json$/))
  .filter(Boolean)
  .map((m) => ({ file: m[0], span: Date.parse(m[3]) - Date.parse(m[2]), end: m[3] }))
  .sort((a, b) => b.span - a.span || b.end.localeCompare(a.end));
if (!files.length) throw new Error('No combined review file in out/. Run fetch-reviews.mjs first.');
const source = files[0].file;

const docs = JSON.parse(await fs.readFile(path.join(OUT, source), 'utf8'))
  .map((r) => ({ ...r, text: `${r.title ?? ''} ${r.body ?? ''}`.trim() }))
  .filter((r) => r.text.length > MIN_BODY_CHARS)
  .map((r) => ({
    rating: r.rating,
    version: r.app_version ? String(r.app_version).split('.').slice(0, PARTS).join('.') : null,
    norm: normalize(r.text),
  }));

const withVersion = docs.filter((d) => d.version);
const areas = config.areas.map((a) => ({
  name: a.name,
  kind: a.kind ?? 'area',
  matchers: a.terms.map(buildMatcher),
  excludes: (a.exclude ?? []).map(buildMatcher),
}));
const hits = (a, norm) => !a.excludes.some((e) => e.re.test(norm)) && a.matchers.some((m) => m.re.test(norm));

// --- Tabulate ---------------------------------------------------------------
const stat = () => ({ n: 0, sum: 0, one: 0 });
const add = (s, rating) => {
  s.n++;
  s.sum += rating;
  if (rating === 1) s.one++;
};
const done = (s) =>
  s.n >= MIN_CELL
    ? { reviews: s.n, avgRating: +(s.sum / s.n).toFixed(2), oneStarPct: +((100 * s.one) / s.n).toFixed(1) }
    : { reviews: s.n, avgRating: null, oneStarPct: null, belowMin: true };

const overall = new Map();
const byArea = new Map(areas.map((a) => [a.name, new Map()]));

for (const d of withVersion) {
  if (!overall.has(d.version)) overall.set(d.version, stat());
  add(overall.get(d.version), d.rating);
  for (const a of areas) {
    if (!hits(a, d.norm)) continue;
    const m = byArea.get(a.name);
    if (!m.has(d.version)) m.set(d.version, stat());
    add(m.get(d.version), d.rating);
  }
}

// Only versions carrying enough overall volume become columns. The rest are real
// but each holds a handful of reviews, and a 136-column table is not readable.
const columns = [...overall.entries()]
  .filter(([, s]) => s.n >= MIN_CELL)
  .map(([v]) => v)
  .sort(compareVersions);

const out = {
  generated: new Date().toISOString(),
  source,
  areaFile,
  minCell: MIN_CELL,
  substantive: docs.length,
  withVersion: withVersion.length,
  withoutVersion: docs.length - withVersion.length,
  splitVersion: config.splitVersion ?? null,
  caveats: [
    `${docs.length - withVersion.length} substantive reviews carry no app version and are excluded here.`,
    `Cells under ${MIN_CELL} reviews show a count but no score: a rate on a handful of reviews is noise.`,
    'Areas are searches, so a review can appear under several areas. Columns do not sum to the version total.',
    'Users are not randomly assigned to versions. People who update quickly may differ from people who do not.',
  ],
  versions: columns.map((v) => ({ version: v, ...done(overall.get(v)) })),
  areas: areas.map((a) => ({
    name: a.name,
    kind: a.kind,
    byVersion: columns.map((v) => ({ version: v, ...done(byArea.get(a.name).get(v) ?? stat()) })),
  })),
};

await fs.writeFile(path.join(OUT, 'version-areas.json'), JSON.stringify(out, null, 2));

// --- Report -----------------------------------------------------------------
const LABEL = 30;
const W = Math.max(9, ...columns.map((v) => v.length + 2));
const pad = (s, n) => String(s).slice(0, n - 1).padEnd(n);
const cell = (c) => (c.belowMin ? `(${c.reviews})`.padStart(W) : `${c.avgRating.toFixed(2)}`.padStart(W));

console.log(`Source: ${source}`);
console.log(`Areas:  ${areaFile}`);
console.log(`${withVersion.length} of ${docs.length} substantive reviews carry a version (${out.withoutVersion} do not)`);
console.log(`Grouped to ${PARTS} version parts. ${columns.length} columns with ${MIN_CELL}+ reviews, oldest first.`);
console.log(`Cells in (brackets) are counts, not scores — too few reviews to rate.\n`);

const head = pad('', LABEL) + columns.map((v) => v.padStart(W)).join('');
console.log(head);
console.log('-'.repeat(head.length));
console.log(pad('ALL WRITTEN REVIEWS', LABEL) + columns.map((v) => cell(done(overall.get(v)))).join(''));
console.log(pad('  one-star share', LABEL) + columns.map((v) => (Math.round(done(overall.get(v)).oneStarPct) + '%').padStart(W)).join(''));
console.log('-'.repeat(head.length));
for (const a of out.areas) {
  console.log(pad(a.name, LABEL) + a.byVersion.map(cell).join(''));
}
console.log('-'.repeat(head.length));
console.log(pad('  reviews on this column', LABEL) + columns.map((v) => String(overall.get(v).n).padStart(W)).join(''));

// A rolled-up column can straddle the break: 2026.4 holds 2026.4.1 (before) and
// 2026.4.3 (after). Saying so is the difference between a blurred column and a
// wrong one.
if (out.splitVersion) {
  const splitCol = String(out.splitVersion).split('.').slice(0, PARTS).join('.');
  const straddles = PARTS < String(out.splitVersion).split('.').length && columns.includes(splitCol);
  console.log(`\nKnown break: ${out.splitVersion}`);
  if (straddles) {
    console.log(`  Column ${splitCol} STRADDLES it — it holds builds from both sides, so that one`);
    console.log(`  column is a blend and not a before or an after. Re-run with --parts 3 to separate.`);
  }
}
console.log('\nCaveats carried into the output:');
for (const c of out.caveats) console.log(`  · ${c}`);
console.log('\nWrote out/version-areas.json');
