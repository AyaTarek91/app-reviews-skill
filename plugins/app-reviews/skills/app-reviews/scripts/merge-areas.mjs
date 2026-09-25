// Join the human codebook to the search probe, so every area carries both numbers.
//
//   node merge-areas.mjs
//
// Reads out/<slug>-codebook.json (what a human decided — the review page names
// its export after the app) and out/area-probe.json (what a search found) and
// writes out/merged-areas.json. out/axis-a-codebook.json, the older fixed name,
// is still read if there is no named one.
//
// The two counts disagree, often badly, and that is not an error to reconcile:
//
//   clustering  every review lands in exactly one group, so the groups add up
//               to the corpus and never overlap. It answers "what is this
//               review MOSTLY about?" — including for reviews that are about
//               nothing in particular, which still have to go somewhere.
//   search      a review matches none, one or five areas. It answers "does this
//               review MENTION x?" and it cannot see anything unnamed.
//
// So a clustered count larger than its searched count means the group absorbed
// reviews that never say the words. A searched count larger than its clustered
// count means the topic is spread across groups instead of owning one. Both are
// findings. Reporting a single blended number would destroy them.
//
// TWO INPUTS ARE OPTIONAL, AND THIS SCRIPT SAYS SO RATHER THAN PRINTING DASHES:
//
//   the join      the codebook's area names are typed by a person on the review
//                 page; the probe's come from areas.json. Nothing makes the two
//                 use the same words, and on a fresh app they usually do not.
//   splitVersion  the release comparison exists only if areas.json names a break
//                 version. Without one there is no before and no after.
//
// Both were assumed present until a run on a second app printed "Split at
// version null" and a column of dashes, which reads as "the data says nothing"
// when it means "you have not told me two things yet".

import fs from 'node:fs/promises';
import path from 'node:path';
import { OUT } from './workdir.mjs';

const probe = JSON.parse(await fs.readFile(path.join(OUT, 'area-probe.json'), 'utf8'));
const slug = (probe.source.match(/^(.+)-reviews_/) ?? [])[1];
const candidates = [`${slug}-codebook.json`, 'axis-a-codebook.json'].map((f) => path.join(OUT, f));
let book = null;
for (const file of candidates) {
  try { book = JSON.parse(await fs.readFile(file, 'utf8')); break; } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`Not valid JSON: ${file}\n  ${err.message}`);
  }
}
if (!book) {
  throw new Error(`No codebook yet. Export it from label-clusters.html and move it into out/.\n  Looked for: ${candidates.join('\n              ')}`);
}

if (book.source !== probe.source) {
  throw new Error(`Codebook and probe were built from different files (${book.source} vs ${probe.source}). Re-run one of them.`);
}

// --- The join ---------------------------------------------------------------
// An explicit "codebookArea" in areas.json first, then an exact match on the two
// names once case, punctuation and "and"/"&" are levelled. Nothing fuzzier: a
// near-miss join would print two confident numbers side by side that are about
// different things, which is worse than printing none.
const normName = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[_\-–—/\\,.:;()'"!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const byExplicit = new Map();
for (const a of probe.areas) if (a.codebookArea) byExplicit.set(normName(a.codebookArea), a);
const byName = new Map(probe.areas.map((a) => [normName(a.name), a]));
const usedProbeAreas = new Set();

function joinFor(name) {
  const key = normName(name);
  const explicit = byExplicit.get(key);
  if (explicit) { usedProbeAreas.add(explicit.name); return { area: explicit, how: 'codebookArea' }; }
  const named = byName.get(key);
  if (named) { usedProbeAreas.add(named.name); return { area: named, how: 'name' }; }
  return { area: null, how: null };
}

// Groups the human ticked as holding two things. Read every shape they come in:
// the current review page exports a flag on each group AND a top-level list of
// {id, note} objects, and an older page exported the top-level list as bare
// numbers. Reading only one of the three loses the ticks silently — the mark
// disappears between the page and the report, and nobody can tell from the
// output that anything was ticked at all.
const flaggedSplits = new Map(
  (book.needs_split ?? [])
    .map((s) => (typeof s === 'number' ? { id: s } : s))
    .filter((s) => s && s.id !== undefined && s.id !== null)
    .map((s) => [s.id, s.note ?? '']),
);

const pct = (v) => (v === null || v === undefined ? null : +(100 * v).toFixed(1));
const splitVersion = probe.splitVersion ?? null;

// --- Areas the human named, each with both counts ---------------------------
const joined = book.axis_a.map((a) => ({ book: a, ...joinFor(a.name) }));
const matchedCount = joined.filter((j) => j.area).length;

const areas = joined.map(({ book: a, area: p, how }) => ({
  name: a.name,
  clustered: {
    reviews: a.reviews,
    avgRating: a.avg_rating ?? null,
    oneStarPct: pct(a.one_star_share),
    groups: a.groups.map((g) => ({
      id: g.id,
      name: g.name,
      reviews: g.reviews,
      needsSplit: !!g.needs_split || flaggedSplits.has(g.id),
      note: g.note || flaggedSplits.get(g.id) || null,
    })),
    needsSplit: a.groups.some((g) => !!g.needs_split || flaggedSplits.has(g.id)),
  },
  searched: p
    ? {
        probeArea: p.name,
        joinedBy: how,
        reviews: p.n,
        avgRating: p.avg,
        oneStarPct: pct(p.oneStar),
        topTerms: p.terms.filter((t) => t.hits > 0).slice(0, 6).map((t) => ({ term: t.term, hits: t.hits })),
        deadTerms: p.terms.filter((t) => t.hits === 0).map((t) => t.term),
        release: p.versions,
      }
    : null,
  // Why the two disagree, stated rather than smoothed over. An unjoined area
  // means one of two very different things, so it must never collapse into one
  // sentence: either nothing links the axes at all, or this area alone has no
  // counterpart.
  gap: p
    ? {
        difference: a.reviews - p.n,
        reading:
          a.reviews > p.n * 1.3
            ? 'Clustering placed more here than the words justify: the group absorbed reviews that never name the topic.'
            : p.n > a.reviews * 1.3
              ? 'The topic is mentioned far more than it was clustered: it is spread across several groups rather than owning one.'
              : 'The two methods broadly agree on this area.',
      }
    : matchedCount === 0
      ? { difference: null, reading: 'Not compared: nothing links the codebook to the search areas yet, so this is a missing setting and not a finding about the data. See join.howToLink.' }
      : { difference: null, reading: 'No search equivalent — this area is a product of how the reviews were grouped, not a topic people write about.' },
  note: p?.note ?? null,
}));

const unmatchedCodebookAreas = joined.filter((j) => !j.area).map((j) => j.book.name);
const unusedProbeAreas = probe.areas
  .filter((a) => (a.kind ?? 'area') === 'area' && !usedProbeAreas.has(a.name))
  .map((a) => a.name);

const join = {
  matched: matchedCount,
  codebookAreas: book.axis_a.length,
  probeAreas: probe.areas.length,
  by: {
    codebookArea: areas.filter((a) => a.searched?.joinedBy === 'codebookArea').length,
    name: areas.filter((a) => a.searched?.joinedBy === 'name').length,
  },
  unmatchedCodebookAreas,
  unusedProbeAreas,
  howToLink:
    matchedCount < book.axis_a.length
      ? 'Add "codebookArea": "<the name typed on the review page>" to the matching area in areas.json, then re-run probe-reviews.mjs and this script. Leaving an area unlinked is fine — a search area with no group of its own is itself a finding.'
      : null,
};

// --- Topics that cut across areas, and topics only search can see -----------
const shape = (p) => ({
  name: p.name,
  reviews: p.n,
  sharePct: pct(p.share),
  avgRating: p.avg,
  oneStarPct: pct(p.oneStar),
  release: p.versions,
  topTerms: p.terms.filter((t) => t.hits > 0).slice(0, 6).map((t) => ({ term: t.term, hits: t.hits })),
  deadTerms: p.terms.filter((t) => t.hits === 0).map((t) => t.term),
  note: p.note ?? null,
});

const crossCutting = probe.areas.filter((a) => a.kind === 'cross').map(shape).sort((a, b) => b.reviews - a.reviews);
const smallThemes = probe.areas.filter((a) => a.kind === 'small').map(shape).sort((a, b) => b.reviews - a.reviews);

// --- Release comparison, ranked --------------------------------------------
// The strongest thing this dataset can do without analytics — and it runs only
// if areas.json named a break version. Only topics with enough reviews on both
// sides of the split are ranked; the rest would be noise.
const MIN_PER_SIDE = 25;
const release = splitVersion
  ? probe.areas
      .filter((a) => a.versions && a.versions.before.n >= MIN_PER_SIDE && a.versions.after.n >= MIN_PER_SIDE)
      .map((a) => ({
        name: a.name,
        kind: a.kind,
        before: { reviews: a.versions.before.n, avgRating: a.versions.before.avg, oneStarPct: pct(a.versions.before.oneStar) },
        after: { reviews: a.versions.after.n, avgRating: a.versions.after.avg, oneStarPct: pct(a.versions.after.oneStar) },
        drop: +(a.versions.after.avg - a.versions.before.avg).toFixed(2),
      }))
      .sort((a, b) => a.drop - b.drop)
  : [];

const caveats = [
  'Clustered and searched counts measure different things and must never be averaged or added.',
  `Search areas overlap: ${probe.coverage.overlapping} reviews matched more than one, so their counts do not sum.`,
  `${probe.coverage.unmatched} of ${probe.coverage.substantive} substantive reviews match no search area at all (${100 - Math.round(100 * probe.coverage.matchedShare)}%).`,
  'Reviews cannot distinguish a defect from a design decision users dislike. Every area below needs a person who knows the product before it is called a bug.',
];
if (splitVersion) {
  caveats.push('The release comparison is not a randomised test: people who update quickly may differ from people who do not.');
} else {
  caveats.push('No release comparison was run: areas.json has no splitVersion, so this file has no before and no after.');
}
if (matchedCount === 0) {
  caveats.push('The two axes are not linked, so every searched count here is empty. That is a missing setting, not a finding about the app.');
} else if (matchedCount < book.axis_a.length) {
  caveats.push(`${book.axis_a.length - matchedCount} of ${book.axis_a.length} codebook areas have no search counterpart; their searched counts are empty for that reason.`);
}

const merged = {
  generated: new Date().toISOString(),
  source: book.source,
  splitVersion,
  releaseComparison: splitVersion ? 'on' : 'off — set splitVersion in areas.json and re-run probe-reviews.mjs',
  totals: book.totals,
  coverage: probe.coverage,
  join,
  caveats,
  areas,
  crossCutting,
  smallThemes,
  release,
};

await fs.writeFile(path.join(OUT, 'merged-areas.json'), JSON.stringify(merged, null, 2));

// --- Console report ---------------------------------------------------------
const pad = (s, n) => String(s).slice(0, n - 1).padEnd(n);
const num = (s, n) => String(s).padStart(n);

console.log(`Source: ${merged.source}`);
if (splitVersion) {
  console.log(`Split at version ${splitVersion}\n`);
} else {
  console.log('Release comparison: OFF — areas.json has no splitVersion.');
  console.log('  Run version-areas.mjs, read which version the score breaks at, then set');
  console.log('  "splitVersion": "<that version>" in areas.json and re-run probe-reviews.mjs.');
  console.log('  Everything else below is unaffected.\n');
}

if (matchedCount === 0) {
  console.log('NOT JOINED — the searched column below is empty, and that is a setting, not a result.');
  console.log('  The codebook areas are the names typed on the review page; the search areas come');
  console.log('  from areas.json. On this app they are different words, so nothing matched.');
  console.log(`  Codebook areas : ${book.axis_a.map((a) => a.name).join(' | ') || '(none)'}`);
  console.log(`  areas.json     : ${probe.areas.map((a) => a.name).join(' | ') || '(none)'}`);
  console.log(`  ${join.howToLink}\n`);
} else if (unmatchedCodebookAreas.length || unusedProbeAreas.length) {
  console.log(`Joined ${matchedCount} of ${book.axis_a.length} codebook areas (${join.by.name} by name, ${join.by.codebookArea} by codebookArea).`);
  if (unmatchedCodebookAreas.length) console.log(`  No search counterpart : ${unmatchedCodebookAreas.join(' | ')}`);
  if (unusedProbeAreas.length) console.log(`  No group of their own : ${unusedProbeAreas.join(' | ')}`);
  console.log(`  ${join.howToLink}\n`);
}

console.log('YOUR AREAS — clustered vs searched');
console.log(pad('area', 40) + num('clustered', 10) + num('searched', 10) + num('score', 7) + '   note');
console.log('-'.repeat(96));
for (const a of areas) {
  console.log(
    pad(a.name, 40) +
      num(a.clustered.reviews, 10) +
      num(a.searched ? a.searched.reviews : '—', 10) +
      num(a.clustered.avgRating?.toFixed(2) ?? '—', 7) +
      '   ' +
      (a.clustered.needsSplit ? 'NEEDS SPLIT. ' : '') +
      (a.searched ? '' : matchedCount === 0 ? 'not joined' : 'no search equivalent'),
  );
}

if (crossCutting.length) {
  console.log('\nCUTS ACROSS AREAS (counted, never a box)');
  for (const c of crossCutting) {
    console.log(pad(c.name, 40) + num(c.reviews, 10) + num(c.sharePct + '%', 9) + num(c.avgRating?.toFixed(2) ?? '—', 7));
  }
}

if (smallThemes.length) {
  console.log('\nONLY SEARCH CAN SEE THESE (too small to cluster)');
  for (const s of smallThemes) {
    console.log(pad(s.name, 40) + num(s.reviews, 10) + num(s.sharePct + '%', 9) + num(s.avgRating?.toFixed(2) ?? '—', 7));
  }
}

if (splitVersion) {
  console.log(`\nWHAT CHANGED AT ${splitVersion} (ranked by drop)`);
  if (release.length) {
    console.log(pad('topic', 40) + num('before', 9) + num('after', 9) + num('drop', 8));
    for (const r of release) {
      console.log(pad(r.name, 40) + num(r.before.avgRating?.toFixed(2) ?? '—', 9) + num(r.after.avgRating?.toFixed(2) ?? '—', 9) + num(r.drop.toFixed(2), 8));
    }
  } else {
    console.log(`  Nothing to rank: no area has ${MIN_PER_SIDE} reviews on both sides of ${splitVersion}.`);
    console.log('  Either the break is too recent, or too few reviews carry an app version.');
  }
}

console.log('\nCaveats carried into the output:');
for (const c of merged.caveats) console.log(`  · ${c}`);
console.log('\nWrote out/merged-areas.json');
