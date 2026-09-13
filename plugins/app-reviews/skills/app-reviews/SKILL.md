---
name: app-reviews
description: Turn App Store and Google Play reviews into a one-page dashboard: the real score behind the store rating, which release broke it, and what people report. Use to analyse app reviews or a rating drop.
---

# App review analysis

Reviews record **issues with what already exists**. They are not needs. This produces
**one discovery input among several** — hypotheses and questions, never a backlog.

- **Strong for:** regressions tied to a release, ranking existing friction by volume and
  anger, and the words customers actually use.
- **Blind to:** unmet needs, silent churn, non-installers, mild dissatisfaction, and
  absolute size (n complaints out of an unknown denominator).

Every finding carries a confidence label and the source that would settle it. Never state
a review-derived count as a measured user need.

## Step 0 — run the preflight, then say what it found

**Run this before anything else, and tell the user what it said in your first reply:**

```
node preflight.mjs
```

It checks the one dependency and actually tries to reach the two store domains, then
prints one of two verdicts: **full pipeline**, or **analysis only**. Do not reason about
which surface you are on or what the settings ought to allow — the check answers it for
the account in front of you, and the docs often do not.

If it reports the package missing:

```
npm install google-play-scraper      # the only dependency. Node 24, ESM.
```

**If the verdict is "analysis only", stop and put the choice to the user before doing
anything else.** Give them both routes in one message, name the two domains, and be clear
about who can actually change the setting:

> The store domains are blocked here, so I cannot collect the reviews myself. Two ways
> forward. Either allow network egress to `play.google.com` and `itunes.apple.com` — on a
> personal plan that is Settings → Capabilities; on Team or Enterprise it is Organization
> settings → Capabilities and **only an organization owner can add specific domains**, so
> if you are not one this needs someone who is. Or upload a reviews file you already
> collected and I will start from the analysis, which needs no network at all.

Do not send them hunting through their own settings for an option their plan may not have,
and do not start the pipeline and let the fetch fail.

Either way the user should never meet a blocked domain or a missing package as an error.
`fetch-reviews.mjs` does fail with a readable message rather than a stack trace, but that
is the backstop, not the plan — the preflight is the plan.

## Where this runs, and what the environment has to allow

The collector reaches the network; **everything after it does not.** That split decides
whether the skill works on the surface you are on.

| | `preflight` / `find-app` / `fetch-reviews` | `cluster` / `probe` / `version` / `cross` / `merge` |
|---|---|---|
| Needs the internet | **yes** — `play.google.com`, `itunes.apple.com` | no |
| Needs a package installed | **yes** — `google-play-scraper` | no, Node standard library only |

- **Claude Code:** everything works. Full network access, `npm install` is fine.
- **claude.ai / Cowork:** network egress defaults to **package managers only**, so
  `npm install google-play-scraper` succeeds but the two store domains are **blocked**.
  You have two honest options, and you should say which one you are in before starting:
  1. Ask the user (or their admin) to allow egress to `play.google.com` and
     `itunes.apple.com` — Settings, network access, "package managers and specific
     domains". Then the full pipeline runs.
  2. **Analyse a file they already have.** Ask them to upload the combined reviews JSON or
     CSV from an earlier Claude Code run, and skip straight to clustering. The five
     analysis scripts need no network and no packages, so this path always works.
- **Claude API:** no network at all and no runtime installs, so only option 2 above.

Do not start the pipeline and let the fetch fail. Check which case you are in first.

## What you need from the user

**Just the app name and the country.** Links are welcome but not required — resolve the
ids yourself:

```
node find-app.mjs "spotify" eg
```

It prints up to five candidates per store with developer, rating and rating count.
**Always show the list and confirm before writing app.json.** The top hit is often the
wrong app — a companion app, a clone, a regional fork — and analysing the wrong app
produces a clean, plausible, entirely wrong report. Check the DEVELOPER name matches on
both stores: the two are joined on your judgement, not on any shared id.

So the only things you actually have to ask for are:

- the app name (or a store link, if they have one to hand)
- the store country — this matters, an app can rank very differently in two storefronts
- the window; six months is a good default

Do **not** open with a vague question about the product. The useful product questions come
later, once there are specific themes to ask about — see the checkpoint below.

## Setup

```
cp scripts/app.example.json scripts/app.json     # then edit it
cp templates/areas.template.json scripts/areas.json
npm install google-play-scraper
```

Node 24, ESM, top-level await. No build step, no tests — do not invent npm scripts.

## The pipeline

```
node preflight.mjs                  # what does this environment allow? run this first
node find-app.mjs "app name" eg      # resolve store ids from a name
node fetch-reviews.mjs 180          # collect. --ios-only reuses the saved Play pull
node cluster-reviews.mjs            # group by topic, k=30 default
node probe-reviews.mjs              # search the named areas, reports zeros too
node version-areas.mjs              # every area by release train
node cross-areas.mjs a.json b.json  # two axes crossed (optional)
node merge-areas.mjs                # codebook + probe side by side (optional)
```

**Clustering and search are opposite tools and you need both.** Clustering answers *"what
is big in here?"* — it must place every review, so a theme smaller than about one k-th of
the corpus is absorbed into its nearest neighbour. That is what clustering *is*, not a bug
in it. Search answers *"is X in here at all?"* — you name the areas, it reports each count
**including zero**. Clustering misses what is small; search misses what you did not think
to ask.

### Naming the clusters

**Do this yourself — do not make the user name 32 groups.** Read each group's top terms and
samples, name it, and give two groups the same name to merge them. Then show the user the
result and ask them to correct anything wrong.

Expect roughly, out of 32: **8 clean single topics, 4 holding two crowds, 6 pure emotion,
13 vague, 1 split by language.** Keep about 8. Tell the user that ratio up front so the
discard pile is not a surprise.

### The defect-or-decision checkpoint

**Before writing up any theme as a bug, list the candidates and ask about each one by
name.** Not "tell me about the product" — a specific question with the evidence attached:

> *"253 reviews say the app does not work on Wi-Fi. Is that a defect, or is it intended?"*

That exact case is why this step exists. The answer was **intended** — the app is
mobile-data-only by design, zero-rated, so it is meant to fail on Wi-Fi. It was about to
ship as "the most fixable thing in the dataset". Wrong on cause, and wrong on size too:
only 136 reviews in the whole corpus mentioned Wi-Fi, so a 253-member group was never all
Wi-Fi complaints.

**Review text cannot distinguish "this is broken" from "this works as designed and users
hate it."** Only someone who knows the product can, and they can only answer when you show
them the specific claim.

The second thing only a human can supply: **whether a search word means what you think** in
the local dialect. Show them `out/area-probe.html`, which lists every term with its hit
count and real examples.

## The rules that are load-bearing

Each was a silent wrong answer before it was a rule.

### Collecting

- **Never merge the two stores into one score.** One app measured 83 iOS reviews against
  34k Android, averaging 1.5 and 4.1. Merging erases iOS completely.
- **Report both denominators.** Over half of Play reviews are one word. The store headline
  largely measures in-app rating-prompt taps, not opinion.
- **Apple caps at ~100 reviews total**, whatever window you ask for. Always report the date
  range actually obtained, not the one requested.
- **Apple's RSS serves a cached EMPTY feed for some URL shapes**, and which shape breaks
  differs per page. `iosUrlForms()` returns four; empty means "try another shape", never
  "no data". Do not simplify it into one URL.
- **Play partitions by the reviewer's device locale, not review language.** Asking in
  Arabic misses Arabic reviews written on German-locale phones. Sweep ~30 locales and dedupe
  by review id.
- **Filter by date before analysing.** Small-language streams are so short they never reach
  the cutoff, leaving rows from years back that look like history but are a trickle.
- **CSV needs the UTF-8 BOM** or Excel mangles non-Latin text.

### Grouping

- **Strip verdict words before clustering.** With them in, 9 of 30 groups formed on mood — a
  "praise" group and a "venting" group instead of product areas. The line that works: a word
  saying how it *was* goes (`bad`, `excellent`), a word saying what *happened* stays
  (`slow`, `error`, `deducted`, `thieves`).
- **The app's own name must be a stopword** or the biggest group forms on it. Put it in
  `app.json` under `stopWords`, with the local words for "app" and "program".
- **Set k HIGHER than the number of areas you expect, then merge down.** Merging two piles
  is typing the same name twice; splitting one is impossible. Tested: dropping k from 32 to
  10 did *not* remove the noise — praise still took 3 of 10 slots — but it welded *login* to
  *update* and *balance* to *bundles*. **Lowering k removes resolution, not noise.**
- **Reviews left with no surviving term are a bucket, not a rounding error.** Report them
  separately; a high average rating inside that bucket is the tell.

### Searching

- **Never report a count without the words that produced it.** A probe for "font"
  complaints returned 192 hits, all wrong: `خط` means *phone line* in Egyptian Arabic and
  also sits inside `الخطأ` ("the error"). The number was clean, plausible and false.
- **A word that matches nothing is reported too.** Zero usually means you guessed the wrong
  local word, not that the topic is absent. Opposite conclusions, identical blank screen.
- **A politeness word is not an intent word.** Searching feature requests with "please" and
  "I beg you" returned 868 hits, every one wrong — they were bug reports. Worse, one of the
  phrases was **the app's own error message**, so 122 hits were users quoting a failure back
  at us. Narrowing to "I wish / I hope" cut it to 372 and *raised* the average rating from
  2.87 to 3.24. **A correct feature-request list scores higher than the other areas** —
  requests come from happier people. If it does not, the terms are wrong.
- **Areas overlap; never sum them.** Merging five small themes by adding their counts gave
  203. Running them as one search gave **145**. The difference is people who matched two.
- **Report coverage.** Roughly half of substantive reviews match no area at all. A probe
  that quietly covers half the corpus while looking complete is the same failure as above.

### Versions — the strongest thing this method does

- **Compare people on an old build against people on a new build inside the same month.**
  Version and calendar time are normally entangled, so a rise in complaints could be the
  release or could be the news that month. Splitting on version breaks the tie. It needs
  only `app_version` and `date`, which every store dataset has.
- **Sort version parts numerically.** As strings, `2026.10.1` sorts before `2026.4.1` and
  silently reverses the timeline — and the finding with it.
- **Never score a cell under ~20 reviews.** An average of 1.00 on three reviews is three
  people, not the worst release.
- **A rolled-up column can straddle the break.** `2026.4` held both `2026.4.1` (3.42) and
  `2026.4.3` (2.20). Say so, or the blend reads as a gentle slope instead of a cliff.
- **State the caveat every time:** users are not randomly assigned to versions. People who
  update fast may differ from people who do not.

## The dashboard

Build from `templates/dashboard.html`. Replace the data arrays near the top of its script
(`MONTHS`, `TRAINS`, `KINDS`) and the tile and table numbers in the markup. Keep the shape:

1. **Tiles** — store score, written-only score, the other store, % saying nothing, break version
2. **Monthly lines** — all reviews against written only, gap shaded
3. **Release bars** — score per release train, break line marked
4. **Horizontal bars** — the seven kinds by volume, red above 65% one-star
5. **Dumbbell** — before and after the break, sorted by how far each fell
6. **Sparklines** — each kind across releases, grey comparison line behind
7. **Three small panels** — the two-way count check, what the channel cannot see, questions for analytics
8. **Method** — the four steps, and why k is set high

Chart rules: **one y-scale per chart, never two** — rating and percentage in one frame can
be made to show almost any relationship. Numbers at 17px. Colours from CSS tokens so a theme
change redraws. Counts inside bars where they fit. Check every label position by arithmetic;
the geometry is hand-written and there is no layout engine to catch a collision.

**Naming: one dashboard per app, in `dashboards/`, named after the app** in both the
filename and the `<title>` — `dashboards/<slug>-dashboard.html`, titled "<App> Reviews
Analysis". The artifact gallery lists pages by title, so a shared title is as unfindable as
a shared filename.

## Checking your own work

After every step, check the result against something independently reasonable — a date
range, a second method, a known total. **Checking that the code ran is not checking that the
answer is possible.**

The best single check available: cluster count against search count for the same area. On
the first app, customer support came out 528 one way and 529 the other — two methods sharing
nothing, landing one review apart. Where they diverge, take the smaller number and say why.

See `references/lessons.md` for the full failure catalogue.
