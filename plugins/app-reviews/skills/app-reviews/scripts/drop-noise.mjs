// Build the list of reviews to drop before a second clustering pass.
//
//   node drop-noise.mjs                      # propose — which groups look like noise
//   node drop-noise.mjs --groups 0,3,5       # build the list from these groups
//   node drop-noise.mjs --area "No content"  # groups filed under this area
//   node drop-noise.mjs --auto               # groups the search barely recognises
//
//   --coverage 0.25   what "barely recognises" means (default 0.25)
//   --out drop-ids.json
//
// THE RULE, AND IT IS THE WHOLE POINT OF THIS SCRIPT:
//
//   Drop a review only when NEITHER method finds a topic in it — clustering put
//   it in a group that says nothing, AND the keyword search matches none of your
//   areas. A review that either method recognises stays.
//
// Never drop a whole group. On the reference app, the group a person had filed
// as praise-and-venting held 4,066 reviews, and the search found a real topic in
// 1,240 of them: 58% one-star, 290 of them detailed complaints over 120
// characters. They had been filed as venting because their VOCABULARY is angry —
// "thieves", "scammers", "they steal the balance" — not because they say nothing.
// Dropping the group deleted the second-largest problem area in the corpus
// (billing and trust: 831 reviews by search, 1.88 average, 73% one-star) from the
// topic map entirely. Keeping those 1,240 and dropping the other 2,826 gave 22 of
// 24 groups that the search recognises, and billing won three groups of its own.
//
// What you get back is a sharper topic map, not a smaller problem. The dropped
// reviews are still part of every denominator: "half of substantive reviews carry
// no topic at all" is a finding about the channel and has to stay in the report.

import fs from 'node:fs/promises';
import path from 'node:path';
import { OUT, WORK } from './workdir.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const COVERAGE = Number(flag('--coverage') ?? 0.25);
const OUT_FILE = flag('--out') ?? 'drop-ids.json';
const GROUPS = flag('--groups');
const AREA = flag('--area');
const AUTO = args.includes('--auto');

const readOut = async (name) => JSON.parse(await fs.readFile(path.join(OUT, name), 'utf8'));
const missing = (name, fix) => new Error(`No out/${name}.\n  Looked in: ${path.join(OUT, name)}\n  ${fix}`);

let members;
try { members = await readOut('cluster-members.json'); }
catch { throw missing('cluster-members.json', 'Run cluster-reviews.mjs first.'); }

let probe;
try { probe = await readOut('area-probe-ids.json'); }
catch { throw missing('area-probe-ids.json', 'Run probe-reviews.mjs first — this rule needs both methods, not one.'); }

// Two files built from different pulls would produce a silent nonsense: ids that
// match nothing, and a drop list that quietly drops almost no one.
if (members.source !== probe.source) {
  throw new Error(`The clustering and the search were built from different files:\n  clustering: ${members.source}\n  search:     ${probe.source}\nRe-run one of them.`);
}

const clusters = await readOut('clusters.json');
const all = JSON.parse(await fs.readFile(path.join(OUT, members.source), 'utf8'));
const index = new Map(all.map((r) => [r.review_id, r]));
const matched = new Set(probe.matchedAny);

const text = (r) => `${r.title ?? ''} ${r.body ?? ''}`.trim();
const statsFor = (ids) => {
  const rows = ids.map((id) => index.get(id)).filter(Boolean);
  if (!rows.length) return { n: 0 };
  const lens = rows.map((r) => text(r).length).sort((a, b) => a - b);
  return {
    n: rows.length,
    avgRating: +(rows.reduce((s, r) => s + r.rating, 0) / rows.length).toFixed(2),
    oneStarPct: Math.round((100 * rows.filter((r) => r.rating === 1).length) / rows.length),
    medianChars: lens[Math.floor(lens.length / 2)],
    longOneStar: rows.filter((r) => r.rating === 1 && text(r).length > 120).length,
  };
};

// How much of each group does the search recognise? This is the one measure here
// that does not depend on anyone's judgement: the search is a different method
// with a hand-written vocabulary, so a group it cannot see is a group whose
// reviews do not name anything.
const byId = new Map(clusters.clusters.map((c) => [c.id, c]));
const groupRows = members.groups.map((g) => {
  const hit = g.review_ids.filter((id) => matched.has(id)).length;
  const c = byId.get(g.id);
  return {
    id: g.id,
    name: c?.suggested_name ?? `group ${g.id}`,
    size: g.review_ids.length,
    avgRating: c?.avg_rating ?? null,
    oneStarPct: c ? Math.round(100 * c.one_star_share) : null,
    coverage: g.review_ids.length ? hit / g.review_ids.length : 0,
    ids: g.review_ids,
  };
}).sort((a, b) => a.coverage - b.coverage);

const pad = (s, n) => String(s).slice(0, n - 1).padEnd(n);
const num = (s, n) => String(s).padStart(n);

// --- Which groups are the noise pile? --------------------------------------
let chosen = null;
let how = null;

if (GROUPS) {
  const want = new Set(GROUPS.split(',').map((s) => Number(s.trim())));
  chosen = groupRows.filter((g) => want.has(g.id));
  const found = new Set(chosen.map((g) => g.id));
  const absent = [...want].filter((id) => !found.has(id));
  if (absent.length) throw new Error(`No such group id in this run: ${absent.join(', ')}. Group ids are positions in the run that produced cluster-members.json.`);
  how = `groups ${[...want].sort((a, b) => a - b).join(', ')}`;
} else if (AREA) {
  // The area a person (or the session) filed the groups under. Both files are
  // optional, so say which one answered and which were looked at.
  const sources = [];
  let assigned = null;
  const slug = (members.source.match(/^(.+)-reviews_/) ?? [])[1];
  for (const name of [`${slug}-codebook.json`, 'axis-a-codebook.json']) {
    sources.push(name);
    try {
      const book = await readOut(name);
      assigned = new Set((book.group_map ?? []).filter((g) => g.area === AREA).map((g) => g.id));
      if (assigned.size) { how = `area "${AREA}" in out/${name}`; break; }
      assigned = null;
    } catch { /* try the next one */ }
  }
  if (!assigned) {
    sources.push('group-names.json');
    try {
      const names = await readOut('group-names.json');
      const list = Array.isArray(names) ? names : names.groups ?? [];
      assigned = new Set(list.filter((g) => g.area === AREA).map((g) => g.id));
      if (assigned.size) how = `area "${AREA}" in out/group-names.json`;
      else assigned = null;
    } catch { /* fall through to the error below */ }
  }
  if (!assigned) {
    throw new Error(`No groups are filed under the area "${AREA}".\n  Looked in: ${sources.map((s) => `out/${s}`).join(', ')}\n  Area names must match exactly. Or name the groups directly: --groups 0,3,5`);
  }
  chosen = groupRows.filter((g) => assigned.has(g.id));
} else if (AUTO) {
  chosen = groupRows.filter((g) => g.coverage < COVERAGE);
  how = `every group the search recognises in under ${Math.round(100 * COVERAGE)}% of members`;
  if (!chosen.length) {
    console.log(`No group falls under ${Math.round(100 * COVERAGE)}% coverage. There is no noise pile to drop here.`);
    process.exit(0);
  }
}

// --- No instruction: propose, and change nothing ---------------------------
if (!chosen) {
  console.log(`Source: ${members.source}`);
  console.log(`${groupRows.length} groups, ${clusters.totals.clustered} reviews clustered, ${matched.size} reviews the search finds a topic in.\n`);
  console.log('GROUPS THE SEARCH BARELY RECOGNISES — the candidates for a second pass');
  console.log(pad('id', 5) + num('size', 6) + num('covered', 9) + num('avg', 6) + num('1★', 5) + '   name');
  console.log('-'.repeat(88));
  const candidates = groupRows.filter((g) => g.coverage < COVERAGE);
  for (const g of candidates) {
    console.log(pad(g.id, 5) + num(g.size, 6) + num(Math.round(100 * g.coverage) + '%', 9) +
      num(g.avgRating?.toFixed(2) ?? '—', 6) + num((g.oneStarPct ?? '—') + '%', 5) + '   ' + g.name);
  }
  if (!candidates.length) console.log('  (none — every group names something)');
  console.log(`\n${candidates.length} groups, ${candidates.reduce((s, g) => s + g.size, 0)} reviews.`);
  console.log('A high average rating in that list is the tell: those are the praise groups.');
  console.log('\nNothing was written. Choose one:');
  console.log(`  node drop-noise.mjs --auto                 # use the list above`);
  console.log(`  node drop-noise.mjs --groups ${candidates.slice(0, 3).map((g) => g.id).join(',') || '0,3,5'}              # pick them yourself`);
  console.log(`  node drop-noise.mjs --area "<area name>"   # use what a person filed`);
  process.exit(0);
}

// --- Apply the rule --------------------------------------------------------
const inChosen = new Set(chosen.flatMap((g) => g.ids));
const rescued = [...inChosen].filter((id) => matched.has(id));
const drop = [...inChosen].filter((id) => !matched.has(id));

const dropStats = statsFor(drop);
const keptStats = statsFor(rescued);

console.log(`Source: ${members.source}`);
console.log(`Noise pile: ${how} — ${chosen.length} groups, ${inChosen.size} reviews\n`);
console.log('THE RULE: drop only what NEITHER method finds a topic in.');
console.log(pad('', 34) + num('reviews', 9) + num('avg', 7) + num('1★', 6) + num('median', 8) + num('long 1★', 9));
console.log('-'.repeat(74));
console.log(pad('dropped (neither method sees it)', 34) + num(dropStats.n, 9) + num(dropStats.avgRating ?? '—', 7) +
  num((dropStats.oneStarPct ?? '—') + '%', 6) + num(dropStats.medianChars ?? '—', 8) + num(dropStats.longOneStar ?? '—', 9));
console.log(pad('kept back (the search sees it)', 34) + num(keptStats.n, 9) + num(keptStats.avgRating ?? '—', 7) +
  num((keptStats.oneStarPct ?? '—') + '%', 6) + num(keptStats.medianChars ?? '—', 8) + num(keptStats.longOneStar ?? '—', 9));

// Never a count without examples. Whoever runs this has to be able to see, in
// three lines, that the right pile is going.
const show = (ids, title) => {
  console.log(`\n${title}`);
  for (const id of ids.slice(0, 3)) {
    const r = index.get(id);
    if (r) console.log(`  [${r.rating}★] ${text(r).replace(/\s+/g, ' ').slice(0, 150)}`);
  }
};
show(drop, 'Three being dropped:');
show(rescued, 'Three kept back — these are why you never drop a whole group:');

if (keptStats.n && keptStats.avgRating !== null && dropStats.avgRating !== null && keptStats.avgRating >= dropStats.avgRating) {
  console.log('\nWARNING: the reviews kept back score no lower than the ones dropped.');
  console.log('  That is backwards — the rescued pile should be the angrier one. Check your');
  console.log('  area terms in the probe page before using this list.');
}

const share = clusters.totals.clustered ? dropStats.n / clusters.totals.clustered : 0;
if (share > 0.6) {
  console.log(`\nWARNING: this drops ${Math.round(100 * share)}% of the clustered reviews. That is most of the corpus.`);
  console.log('  Re-read the three examples above and make sure they really say nothing.');
}

const file = path.join(OUT, OUT_FILE);
await fs.writeFile(file, JSON.stringify(drop), 'utf8');
console.log(`\nWrote ${file} (${drop.length} ids)`);
console.log('\nSHOW THE PERSON THE TWO PILES ABOVE AND WAIT FOR A YES.');
console.log('  They are the only one who can tell you the set-aside pile is really contentless');
console.log('  and not ordinary complaints in words your search never learned. Give them the');
console.log('  counts, both averages and one-star shares, and the examples. Then run:');
console.log(`  node "${path.relative(WORK, process.argv[1]).replace(/\\/g, '/').replace('drop-noise.mjs', 'cluster-reviews.mjs')}" --exclude out/${OUT_FILE} --prefix pass2`);
console.log('Then compare: pass2 should have fewer groups the search cannot see, and the');
console.log('dropped reviews must still appear in your denominators.');
