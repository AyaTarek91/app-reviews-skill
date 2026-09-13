// Join the human codebook to the search probe, so every area carries both numbers.
//
//   node merge-areas.mjs
//
// Reads out/axis-a-codebook.json (what a human decided) and out/area-probe.json
// (what a search found) and writes out/merged-areas.json.
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

import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, 'out');
const book = JSON.parse(await fs.readFile(path.join(OUT, 'axis-a-codebook.json'), 'utf8'));
const probe = JSON.parse(await fs.readFile(path.join(OUT, 'area-probe.json'), 'utf8'));

if (book.source !== probe.source) {
  throw new Error(`Codebook and probe were built from different files (${book.source} vs ${probe.source}). Re-run one of them.`);
}

const probeByCodebook = new Map(probe.areas.filter((a) => a.codebookArea).map((a) => [a.codebookArea, a]));
const pct = (v) => (v === null || v === undefined ? null : +(100 * v).toFixed(1));

// --- Areas the human named, each with both counts ---------------------------
const areas = book.axis_a.map((a) => {
  const p = probeByCodebook.get(a.name) ?? null;
  return {
    name: a.name,
    clustered: {
      reviews: a.reviews,
      avgRating: a.avg_rating,
      oneStarPct: pct(a.one_star_share),
      groups: a.groups.map((g) => ({ id: g.id, name: g.name, reviews: g.reviews, needsSplit: !!g.needs_split, note: g.note ?? null })),
      needsSplit: a.groups.some((g) => g.needs_split),
    },
    searched: p
      ? {
          probeArea: p.name,
          reviews: p.n,
          avgRating: p.avg,
          oneStarPct: pct(p.oneStar),
          topTerms: p.terms.filter((t) => t.hits > 0).slice(0, 6).map((t) => ({ term: t.term, hits: t.hits })),
          deadTerms: p.terms.filter((t) => t.hits === 0).map((t) => t.term),
          release: p.versions,
        }
      : null,
    // Why the two disagree, stated rather than smoothed over.
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
      : { difference: null, reading: 'No search equivalent — this area is a product of how the reviews were grouped, not a topic people write about.' },
    note: p?.note ?? null,
  };
});

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
// The strongest thing this dataset can do without analytics. Only topics with
// enough reviews on both sides of the split are ranked; the rest would be noise.
const MIN_PER_SIDE = 25;
const release = probe.areas
  .filter((a) => a.versions && a.versions.before.n >= MIN_PER_SIDE && a.versions.after.n >= MIN_PER_SIDE)
  .map((a) => ({
    name: a.name,
    kind: a.kind,
    before: { reviews: a.versions.before.n, avgRating: a.versions.before.avg, oneStarPct: pct(a.versions.before.oneStar) },
    after: { reviews: a.versions.after.n, avgRating: a.versions.after.avg, oneStarPct: pct(a.versions.after.oneStar) },
    drop: +(a.versions.after.avg - a.versions.before.avg).toFixed(2),
  }))
  .sort((a, b) => a.drop - b.drop);

const merged = {
  generated: new Date().toISOString(),
  source: book.source,
  splitVersion: probe.splitVersion,
  totals: book.totals,
  coverage: probe.coverage,
  caveats: [
    'Clustered and searched counts measure different things and must never be averaged or added.',
    `Search areas overlap: ${probe.coverage.overlapping} reviews matched more than one, so their counts do not sum.`,
    `${probe.coverage.unmatched} of ${probe.coverage.substantive} substantive reviews match no search area at all (${100 - Math.round(100 * probe.coverage.matchedShare)}%).`,
    'Reviews cannot distinguish a defect from a design decision users dislike. Every area below needs a person who knows the product before it is called a bug.',
    'The release comparison is not a randomised test: people who update quickly may differ from people who do not.',
  ],
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
console.log(`Split at version ${merged.splitVersion}\n`);

console.log('YOUR AREAS — clustered vs searched');
console.log(pad('area', 40) + num('clustered', 10) + num('searched', 10) + num('score', 7) + '   note');
console.log('-'.repeat(96));
for (const a of areas) {
  console.log(
    pad(a.name, 40) +
      num(a.clustered.reviews, 10) +
      num(a.searched ? a.searched.reviews : '—', 10) +
      num(a.clustered.avgRating.toFixed(2), 7) +
      '   ' +
      (a.clustered.needsSplit ? 'NEEDS SPLIT. ' : '') +
      (a.searched ? '' : 'no search equivalent'),
  );
}

console.log('\nCUTS ACROSS AREAS (counted, never a box)');
for (const c of crossCutting) {
  console.log(pad(c.name, 40) + num(c.reviews, 10) + num(c.sharePct + '%', 9) + num(c.avgRating.toFixed(2), 7));
}

console.log('\nONLY SEARCH CAN SEE THESE (too small to cluster)');
for (const s of smallThemes) {
  console.log(pad(s.name, 40) + num(s.reviews, 10) + num(s.sharePct + '%', 9) + num(s.avgRating?.toFixed(2) ?? '—', 7));
}

console.log(`\nWHAT CHANGED AT ${merged.splitVersion} (ranked by drop)`);
console.log(pad('topic', 40) + num('before', 9) + num('after', 9) + num('drop', 8));
for (const r of release) {
  console.log(pad(r.name, 40) + num(r.before.avgRating.toFixed(2), 9) + num(r.after.avgRating.toFixed(2), 9) + num(r.drop.toFixed(2), 8));
}

console.log('\nCaveats carried into the output:');
for (const c of merged.caveats) console.log(`  · ${c}`);
console.log('\nWrote out/merged-areas.json');
