// Put your names for the groups onto the review page before the person sees it.
//
//   node name-groups.mjs [names.json]      default: out/group-names.json
//
// cluster-reviews.mjs builds out/label-clusters.html with each group's raw top
// words as its name ("don / words / doesn"). You are meant to name the groups
// yourself and then have the person correct you — but without this step your
// names never reach the page, so the person reviews raw words while your names
// sit in a chat message beside it. This rebuilds the page with your names and
// your proposed areas filled in, ready to correct.
//
// The names file:
//
//   {
//     "source": "<the reviews file clusters.json was built from>",
//     "k": 72,
//     "groups": {
//       "0":  { "name": "Fun, general praise", "area": "No content (praise or venting)" },
//       "14": { "name": "Subscription price",  "area": "Subscription & billing" },
//       "21": "Doesn't really teach"
//     }
//   }
//
// A plain string is a name with no area. Groups given the same area are merged
// on the page. "source" and "k" must match clusters.json, because group ids are
// positions in one clustering run: names written for another run would land on
// the wrong groups and look entirely normal.
//
// clusters.json is not changed. Only the page is rebuilt.

import fs from 'node:fs/promises';
import path from 'node:path';
import { OUT, writeLabelPage } from './workdir.mjs';

const namesFile = path.resolve(OUT, process.argv[2] ?? 'group-names.json');

const readJson = async (file, hint) => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    throw new Error(err.code === 'ENOENT'
      ? `Not found: ${file}\n  ${hint}`
      : `Not valid JSON: ${file}\n  ${err.message}`);
  }
};

const data = await readJson(path.join(OUT, 'clusters.json'), 'Run cluster-reviews.mjs first.');
const names = await readJson(namesFile, 'Write your group names there first — the format is at the top of name-groups.mjs.');

if (names.source !== data.source || Number(names.k) !== data.params.k) {
  throw new Error(
    'These names were written for a different clustering run, so the group ids do not line up.\n' +
    `  clusters.json: ${data.source}, k=${data.params.k}\n` +
    `  names file:    ${names.source ?? '(no source)'}, k=${names.k ?? '(no k)'}\n` +
    '  Name the groups in the current clusters.json and set "source" and "k" to match it.');
}

const byId = new Map(data.clusters.map((c) => [String(c.id), c]));
const unknown = Object.keys(names.groups ?? {}).filter((id) => !byId.has(id));
if (unknown.length) throw new Error(`No group with id ${unknown.join(', ')} in clusters.json (ids run 0–${data.params.k - 1}).`);

for (const c of data.clusters) {
  const entry = names.groups?.[String(c.id)];
  if (!entry) continue;
  const { name, area } = typeof entry === 'string' ? { name: entry } : entry;
  if (name) c.session_name = String(name).trim();
  if (area) c.session_area = String(area).trim();
}

const page = await writeLabelPage(data);

// Echo the result by area, so what the person is about to see is also on record here.
const areas = new Map();
for (const c of data.clusters) {
  const key = c.session_area ?? '(no area)';
  if (!areas.has(key)) areas.set(key, []);
  areas.get(key).push(c);
}
for (const [area, groups] of [...areas].sort((a, b) =>
  b[1].reduce((s, c) => s + c.size, 0) - a[1].reduce((s, c) => s + c.size, 0))) {
  const n = groups.reduce((s, c) => s + c.size, 0);
  const avg = groups.reduce((s, c) => s + c.avg_rating * c.size, 0) / n;
  console.log(`\n${area}  ${n.toLocaleString()} reviews, avg ${avg.toFixed(2)}`);
  for (const c of groups) console.log(`  #${String(c.id).padEnd(3)} ${String(c.size).padStart(5)}  ${c.avg_rating.toFixed(2)}  ${c.session_name ?? c.suggested_name}`);
}

const unnamed = data.clusters.filter((c) => !c.session_name).length;
if (unnamed) console.log(`\n${unnamed} group(s) still show their raw top words.`);
console.log(`\nWrote ${page}`);
console.log('Now give the person that path, and wait for their export before building on the groups.');
