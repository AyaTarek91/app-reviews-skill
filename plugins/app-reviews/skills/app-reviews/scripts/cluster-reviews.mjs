// Group substantive reviews into candidate product areas (draft Axis A).
//
//   node cluster-reviews.mjs [k]           default: set from the number of reviews
//
// Reads the widest combined file in ./out and writes out/clusters.json, which
// the labelling page reads so a human can merge, rename and split the groups.
// To put your own names on the page, run name-groups.mjs afterwards.
//
// No ML library on this machine and no Python, so this is plain TF-IDF plus
// spherical k-means (k-means on cosine distance). 7.8k short documents is
// small enough that the naive version runs in seconds.
//
// Nothing here knows it is looking at a telco app. The only app-specific input
// is the stopword list, and even that is mostly "words any review uses".

import fs from 'node:fs/promises';
import path from 'node:path';
import { OUT, readWorkConfig, widestCombinedFile, writeLabelPage } from './workdir.mjs';

const args = process.argv.slice(2);
const K_ASKED = args.find((a) => /^\d+$/.test(a));
// Clustering must place every review, so a theme smaller than about one k-th
// of the corpus cannot win a group of its own. A fixed k therefore gets coarser
// as the corpus grows: 32 was right for 7.8k reviews, but on 18k (Duolingo) the
// smallest group was 263 and subscription, bugs and support complaints — 1,225,
// 657 and 192 reviews by search — got no group at all, while praise filled 26
// of the 32. At 72 the subscription group appeared. So by default aim for about
// this many reviews per group, and never go below 32.
const REVIEWS_PER_GROUP = 250;
const MIN_K = 32;
const MAX_K = 120;
// Reviews shorter than this are the rating-prompt taps (ممتاز, "good"). Over
// half of Play reviews land here and they carry no topic at all.
const MIN_BODY_CHARS = 30;
// A term must appear in at least this many reviews to be a feature, and in at
// most this share of them. The floor kills typos; the ceiling kills words like
// "app" that every cluster would share.
const MIN_DOC_FREQ = 5;
const MAX_DOC_RATIO = 0.3;
const RESTARTS = 8;
const MAX_ITERS = 60;
const TERMS_PER_CLUSTER = 12;
const SAMPLES_PER_CLUSTER = 10;



// --- Text normalisation ----------------------------------------------------
// Arabic writes the same word several ways: أ/إ/آ vs ا, ى vs ي, ة vs ه, plus
// optional vowel marks that most people omit. Without folding these together,
// "الإنترنت" and "الانترنت" look like two unrelated words and the clusters
// split on spelling instead of meaning.
const DIACRITICS = /[ً-ٰٟـ]/g; // harakat + tatweel

function normalize(text) {
  return text
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)) // Arabic-Indic digits
    .toLowerCase();
}

// Arabic glues prefixes and suffixes onto the stem, so "التطبيق", "بالتطبيق"
// and "تطبيقكم" are one idea in three shapes. This is a deliberately timid
// stemmer: it only strips affixes when enough stem is left to stay meaningful.
const PREFIXES = ['وال', 'فال', 'بال', 'كال', 'لل', 'ال', 'و', 'ف', 'ب', 'ك', 'ل'];
const SUFFIXES = ['كم', 'هم', 'ها', 'نا', 'ين', 'ون', 'ات', 'ان', 'يه', 'ه', 'ي', 'ا'];

function stem(word) {
  let w = word;
  if (!/[؀-ۿ]/.test(w)) return w; // leave Latin words alone
  for (const p of PREFIXES) {
    if (w.startsWith(p) && w.length - p.length >= 3) { w = w.slice(p.length); break; }
  }
  for (const s of SUFFIXES) {
    if (w.endsWith(s) && w.length - s.length >= 3) { w = w.slice(0, -s.length); break; }
  }
  return w;
}

// Function words plus the words every review of any app contains. These carry
// no topic, and left in they dominate the centroids.
const STOPWORDS = new Set(`
في من على الي عن مع هذا هذه ذلك التي الذي كل بعد قبل حتي عند لكن او ام ان انا انت
هو هي هم نحن كان كانت يكون تكون ما لا لم لن ليس قد كما بين حول ضد دون سوي غير
يا اي كيف لماذا متي اين هل بس خالص اوي قوي جدا كتير شويه برضو برضه دي ده دا
كده كدا يعني عشان علشان عايز عاوز عوز نفسي ياريت ريت ارجو رجاء لو اذا ياجماعه
والله الله ربنا انشاء بقي خلاص تاني كمان بردو فين ازاي ايه ليه امتي مش مافيش
فيه فيها عندي عندنا عندك ليا ليك له لها منه منها بيه بيها اللي علي الا الان
شكرا مشكور تسلم تحيه سلام اهلا
the and for you your with this that have has was were are not but from all can
its it's app application program software please thank thanks very really just
too also they them their there then than when what why how who which some any
one two get got make made use used using need needs want wants will would
should could been being does did doing about after before over under more most
much many other same such only own again once here now
to in on is be of am at as or if so up out no do don't doesn't didn't cant
can't won't me my mine we us our his her him he she it i a an by into it's
still even every always never ever anything something nothing everything
because while during through against between both each few nor own too
guys sir dear hello hi ok okay yes yeah pls plz

`.trim().split(/\s+/));

// The app's OWN name must be a stopword, or the largest cluster forms on it.
// It differs per app, so it comes from app.json instead of living here. Include
// the local words for 'app' and 'program' too — nearly every review says them.
try {
  const cfg = await readWorkConfig('app.json');
  for (const w of cfg.stopWords ?? []) STOPWORDS.add(String(w).toLowerCase());
} catch { /* no app.json: the generic list still works, just less cleanly */ }

// Stemming makes "سيئة" and "سيء" match, but "سيي" is not a word anyone would
// recognise in a cluster name. So remember which real spelling each stem came
// from most often, and label the clusters with that instead.
const surfaceForms = new Map();
function rememberSurface(stemmed, raw) {
  let seen = surfaceForms.get(stemmed);
  if (!seen) surfaceForms.set(stemmed, (seen = new Map()));
  seen.set(raw, (seen.get(raw) ?? 0) + 1);
}

function displayTerm(term) {
  return term.split(' ').map((part) => {
    const seen = surfaceForms.get(part);
    if (!seen) return part;
    let bestWord = part;
    let bestCount = -1;
    for (const [word, count] of seen) if (count > bestCount) { bestCount = count; bestWord = word; }
    return bestWord;
  }).join(' ');
}

// Pure verdict words. "Excellent" and "garbage" say how the writer felt, not
// what part of the product they were using, so left in they pull whole
// clusters together on mood and cost us the slots we need for topics. Rating
// and 1-star share already carry the feeling.
//
// The line is: a word that says how it WAS is out; a word that says what
// HAPPENED stays. So "bad" goes, "slow", "error", "deducted" and "thieves"
// stay — those name a problem someone can fix.
const SENTIMENT = new Set(`
ممتاز منتاز رايع جميل حلو حلوه جيد تمام عظيم احسن افضل اجمل اروع كويس جامد
تحفه رهيب مفيد سهل بسيط عالي برافو شيك خرافي فخم راقي مبدع محترم نضيف
زفت زباله سيي وحش فاشل بايخ خايب مقرف تافه غبي اسوا قرف هباب بشع
good great excellent nice best bad worst awesome perfect amazing wonderful
love hate terrible horrible useless garbage trash rubbish poor easy simple
helpful cool fine lovely beautiful brilliant super ok
`.trim().split(/\s+/).map(stem));

function tokenize(text) {
  const raws = normalize(text)
    .replace(/[^؀-ۿa-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && w.length <= 25 && !/^\d+$/.test(w))
    .filter((w) => !STOPWORDS.has(w));

  const words = [];
  for (const raw of raws) {
    const s = stem(raw);
    if (s.length < 2 || STOPWORDS.has(s) || SENTIMENT.has(s)) continue;
    rememberSurface(s, raw);
    words.push(s);
  }

  // Bigrams catch the phrases that actually name a feature — "فودافون كاش",
  // "تسجيل دخول", "شحن رصيد" — which the single words alone would scatter.
  const grams = [...words];
  for (let i = 0; i + 1 < words.length; i++) grams.push(`${words[i]} ${words[i + 1]}`);
  return grams;
}

// --- Vectorising -----------------------------------------------------------
function buildVectors(docs) {
  const docFreq = new Map();
  const tokenised = docs.map((d) => {
    const counts = new Map();
    for (const t of tokenize(d.text)) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const t of counts.keys()) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    return counts;
  });

  const maxDf = docs.length * MAX_DOC_RATIO;
  const vocab = new Map();
  const idf = [];
  for (const [term, df] of docFreq) {
    if (df < MIN_DOC_FREQ || df > maxDf) continue;
    vocab.set(term, idf.length);
    idf.push(Math.log(docs.length / df) + 1);
  }

  // Sparse rows: parallel index/value arrays, L2-normalised so a dot product
  // is the cosine similarity.
  const vectors = tokenised.map((counts) => {
    const idx = [];
    const val = [];
    for (const [term, tf] of counts) {
      const j = vocab.get(term);
      if (j === undefined) continue;
      idx.push(j);
      val.push((1 + Math.log(tf)) * idf[j]);
    }
    let norm = 0;
    for (const v of val) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < val.length; i++) val[i] /= norm;
    return { idx, val, norm };
  });

  const terms = new Array(vocab.size);
  for (const [term, j] of vocab) terms[j] = term;
  return { vectors, terms };
}

// --- Spherical k-means -----------------------------------------------------
function dot(vec, centroid) {
  let s = 0;
  for (let i = 0; i < vec.idx.length; i++) s += vec.val[i] * centroid[vec.idx[i]];
  return s;
}

function kmeansPlusPlus(vectors, k, dim, rand) {
  const centroids = [];
  const first = vectors[Math.floor(rand() * vectors.length)];
  const push = (vec) => {
    const c = new Float64Array(dim);
    for (let i = 0; i < vec.idx.length; i++) c[vec.idx[i]] = vec.val[i];
    centroids.push(c);
  };
  push(first);

  // Distance here is 1 - cosine, so seeds spread across unrelated topics
  // instead of all landing in the biggest one.
  const best = vectors.map((v) => 1 - dot(v, centroids[0]));
  while (centroids.length < k) {
    let total = 0;
    for (const d of best) total += d * d;
    let target = rand() * total;
    let pick = 0;
    for (let i = 0; i < best.length; i++) {
      target -= best[i] * best[i];
      if (target <= 0) { pick = i; break; }
    }
    push(vectors[pick]);
    const c = centroids[centroids.length - 1];
    for (let i = 0; i < vectors.length; i++) {
      best[i] = Math.min(best[i], 1 - dot(vectors[i], c));
    }
  }
  return centroids;
}

function runKmeans(vectors, k, dim, seed) {
  let state = seed;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };

  let centroids = kmeansPlusPlus(vectors, k, dim, rand);
  const assign = new Int32Array(vectors.length).fill(-1);
  let objective = 0;

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    let changed = 0;
    objective = 0;
    for (let i = 0; i < vectors.length; i++) {
      let bestSim = -Infinity;
      let bestC = 0;
      for (let c = 0; c < k; c++) {
        const sim = dot(vectors[i], centroids[c]);
        if (sim > bestSim) { bestSim = sim; bestC = c; }
      }
      objective += bestSim;
      if (assign[i] !== bestC) { assign[i] = bestC; changed++; }
    }

    const next = Array.from({ length: k }, () => new Float64Array(dim));
    const sizes = new Int32Array(k);
    for (let i = 0; i < vectors.length; i++) {
      const c = assign[i];
      sizes[c]++;
      const v = vectors[i];
      for (let j = 0; j < v.idx.length; j++) next[c][v.idx[j]] += v.val[j];
    }
    for (let c = 0; c < k; c++) {
      if (sizes[c] === 0) {
        // An empty cluster is a wasted slot. Restart it on a random review
        // rather than leaving k-1 real groups.
        const v = vectors[Math.floor(rand() * vectors.length)];
        for (let j = 0; j < v.idx.length; j++) next[c][v.idx[j]] = v.val[j];
      }
      let norm = 0;
      for (const x of next[c]) norm += x * x;
      norm = Math.sqrt(norm);
      if (norm > 0) for (let j = 0; j < dim; j++) next[c][j] /= norm;
    }
    centroids = next;
    if (changed === 0) break;
  }
  return { assign, centroids, objective };
}

// --- Reporting -------------------------------------------------------------
function versionSpread(rows) {
  const counts = new Map();
  for (const r of rows) {
    const v = r.app_version || '(unknown)';
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([version, count]) => ({ version, count }));
}

function monthSpread(rows) {
  const counts = new Map();
  for (const r of rows) {
    const m = r.date.slice(0, 7);
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, count]) => ({ month, count }));
}

// --- Driver ----------------------------------------------------------------
// Pick the widest window, not the newest name. Sorting the filenames picks
// the 30-day pull over the 6-month one, because "07-09" sorts after "02-10".
const source = args.find((a) => a.endsWith('.json')) ?? await widestCombinedFile();
const all = JSON.parse(await fs.readFile(path.join(OUT, source), 'utf8'));

const docs = all
  .map((r) => ({ ...r, text: `${r.title ?? ''} ${r.body ?? ''}`.trim() }))
  .filter((r) => r.text.length > MIN_BODY_CHARS);

const iosTotal = all.filter((r) => r.store === 'App Store').length;
const playTotal = all.length - iosTotal;
const iosSub = docs.filter((r) => r.store === 'App Store').length;

console.log(`Source: ${source}`);
console.log(`Reviews: ${all.length} total (${playTotal} Play, ${iosTotal} iOS)`);
console.log(`Substantive (>${MIN_BODY_CHARS} chars): ${docs.length} (${docs.length - iosSub} Play, ${iosSub} iOS)\n`);

const { vectors, terms } = buildVectors(docs);
console.log(`Vocabulary: ${terms.length} terms after df filter (>=${MIN_DOC_FREQ}, <=${Math.round(MAX_DOC_RATIO * 100)}%)`);

// A review with no surviving term is long enough to look substantive but says
// only "excellent" or "garbage" over and over. It has no topic to cluster on.
// This is the signal filter the plan asks for: keep it as its own bucket and
// report the number, rather than quietly folding the noise into real groups.
const placeable = [];
const noTopic = [];
for (let i = 0; i < docs.length; i++) {
  (vectors[i].idx.length ? placeable : noTopic).push(i);
}
const useVecs = placeable.map((i) => vectors[i]);
const noTopicAvg = noTopic.length
  ? (noTopic.reduce((s, i) => s + docs[i].rating, 0) / noTopic.length).toFixed(2) : 'n/a';
console.log(`Clusterable: ${placeable.length}`);
console.log(`No topic (verdict only): ${noTopic.length}, avg rating ${noTopicAvg}`);

const K = K_ASKED
  ? Number(K_ASKED)
  : Math.min(MAX_K, Math.max(MIN_K, Math.round(placeable.length / REVIEWS_PER_GROUP)));
// Say out loud what this k cannot see, so nobody reads a missing theme as an
// absent one. The keyword search (probe-reviews.mjs) is what finds those.
console.log(`Groups: ${K}${K_ASKED ? ' (as asked)' : ` (about ${REVIEWS_PER_GROUP} reviews each)`}` +
  ` — a theme under about ${Math.round(placeable.length / K)} reviews cannot win a group of its own\n`);

let best = null;
for (let r = 0; r < RESTARTS; r++) {
  const run = runKmeans(useVecs, K, terms.length, 12345 + r * 7919);
  process.stdout.write(`  restart ${r + 1}/${RESTARTS}  cohesion ${(run.objective / useVecs.length).toFixed(4)}\n`);
  if (!best || run.objective > best.objective) best = run;
}
console.log(`\nBest cohesion: ${(best.objective / useVecs.length).toFixed(4)} (1.0 = identical, 0 = unrelated)\n`);

const clusters = Array.from({ length: K }, (_, c) => ({ id: c, members: [] }));
for (let i = 0; i < placeable.length; i++) {
  clusters[best.assign[i]].members.push({ doc: placeable[i], sim: dot(useVecs[i], best.centroids[best.assign[i]]) });
}

const report = clusters.map((cl) => {
  const rows = cl.members.map((m) => docs[m.doc]);
  const centroid = best.centroids[cl.id];
  const topTerms = [...centroid.keys()]
    .map((j) => ({ term: terms[j], weight: centroid[j] }))
    .filter((t) => t.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, TERMS_PER_CLUSTER)
    .map((t) => displayTerm(t.term));

  const byRating = [1, 2, 3, 4, 5].map((s) => rows.filter((r) => r.rating === s).length);
  const samples = [...cl.members]
    .sort((a, b) => b.sim - a.sim)
    .slice(0, SAMPLES_PER_CLUSTER)
    .map((m) => {
      const r = docs[m.doc];
      return {
        review_id: r.review_id, store: r.store, rating: r.rating,
        date: r.date.slice(0, 10), app_version: r.app_version, text: r.text
      };
    });

  return {
    id: cl.id,
    suggested_name: topTerms.slice(0, 3).join(' / '),
    size: rows.length,
    ios: rows.filter((r) => r.store === 'App Store').length,
    avg_rating: rows.length ? Number((rows.reduce((s, r) => s + r.rating, 0) / rows.length).toFixed(2)) : 0,
    one_star_share: rows.length ? Number((byRating[0] / rows.length).toFixed(3)) : 0,
    rating_histogram: byRating,
    top_terms: topTerms,
    versions: versionSpread(rows),
    months: monthSpread(rows),
    samples
  };
}).sort((a, b) => b.size - a.size);

const out = {
  generated: new Date().toISOString(),
  source,
  params: { k: K, min_body_chars: MIN_BODY_CHARS, min_doc_freq: MIN_DOC_FREQ, max_doc_ratio: MAX_DOC_RATIO },
  totals: {
    all_reviews: all.length, play: playTotal, ios: iosTotal,
    substantive: docs.length, clustered: placeable.length, no_topic: noTopic.length
  },
  no_topic: {
    size: noTopic.length,
    avg_rating: Number(noTopicAvg) || 0,
    samples: noTopic.slice(0, SAMPLES_PER_CLUSTER).map((i) => {
      const r = docs[i];
      return {
        review_id: r.review_id, store: r.store, rating: r.rating,
        date: r.date.slice(0, 10), app_version: r.app_version, text: r.text
      };
    })
  },
  clusters: report
};
await fs.writeFile(path.join(OUT, 'clusters.json'), JSON.stringify(out, null, 2), 'utf8');

await writeLabelPage(out);

console.log('size   ios  avg  1★    name');
for (const c of report) {
  console.log(
    `${String(c.size).padStart(5)} ${String(c.ios).padStart(4)}  ${c.avg_rating.toFixed(2)} ` +
    `${String(Math.round(c.one_star_share * 100)).padStart(3)}%  ${c.suggested_name}`
  );
}
console.log(`\nWrote out/clusters.json`);
console.log(`Wrote ${path.join(OUT, 'label-clusters.html')}`);
console.log('  Name the groups, then run name-groups.mjs to put your names on that page');
console.log('  before handing it to the person. Group ids are positions in THIS run.');
