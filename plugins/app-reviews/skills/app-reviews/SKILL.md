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

```bash
node "$SKILL/scripts/preflight.mjs"
```

It prints the directory it resolved — check that line is the user's folder, not the
skill's, before starting anything long. Then it checks the one dependency and actually
tries to reach the two store domains, then
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
node "$SKILL/scripts/find-app.mjs" "spotify" eg
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

## Where everything goes — run from the user's folder, never the skill's

**Work in the folder the user is in. Never write into the skill directory.** The scripts
live with the skill and are read-only; `app.json`, `areas.json` and everything in `out/`
belong to the person and are read and written in the **current working directory**.

Set `$SKILL` once and every command below just works:

```bash
SKILL=path/to/skills/app-reviews          # wherever the skill is installed
```

Four reasons this matters, each one a real failure and not a preference:

1. Someone asks for an analysis of their app and the data lands in a hidden folder under
   `~/.claude` they would never look in, while the folder they are sitting in stays empty.
2. `app.json` and `areas.json` are single-slot. In the skill folder, analysing a second app
   silently destroys the first app's configuration.
3. Every read and write outside the working directory raises a permission prompt. A
   first-time user reads that as "this tool is doing something it should not".
4. **`claude plugin install` and plugin updates replace the skill directory.** Anything
   kept there is gone on the next update — including a collection that took twenty minutes.

If the analysis should not live in the current directory, set `APP_REVIEWS_DIR` instead of
moving the files. `preflight.mjs` prints the directory it resolved, so check that line
before starting a long collection.

**Never copy the scripts or templates into the user's folder.** Run them from where the
skill is installed. The scripts look for `google-play-scraper` in the user's folder first,
and that works across drives. If preflight prints `[ok] google-play-scraper is installed`,
the package is found. Believe that line rather than reasoning about module resolution. A
copied tool never gets fixes, and nothing tells the user it has gone stale. (A test session
did exactly this, on a wrong guess that the package could not be found from another drive.)

## Setup

Run these **in the user's folder**, not in the skill's:

```bash
cp "$SKILL/scripts/app.example.json" ./app.json          # then edit it
cp "$SKILL/templates/areas.template.json" ./areas.json
npm install google-play-scraper                          # installs here, resolved from here
```

Node 24, ESM, top-level await. No build step, no tests — do not invent npm scripts.

## The pipeline

Still from the user's folder:

```bash
node "$SKILL/scripts/preflight.mjs"          # what does this environment allow? run first
node "$SKILL/scripts/find-app.mjs" "app name" eg   # resolve store ids from a name
node "$SKILL/scripts/fetch-reviews.mjs" 180  # collect. --ios-only reuses the saved Play pull

# --- grouping runs twice; the second run is the one you report ---------------
node "$SKILL/scripts/cluster-reviews.mjs"    # first pass — working material, never the deliverable
node "$SKILL/scripts/probe-reviews.mjs"      # search the named areas, reports zeros too
node "$SKILL/scripts/drop-noise.mjs" --auto  # set aside what NEITHER method finds a topic in
#   ^ STOP: show the person both piles and wait for a yes before the line below
node "$SKILL/scripts/cluster-reviews.mjs" --exclude out/drop-ids.json --prefix pass2
node "$SKILL/scripts/name-groups.mjs" group-names.json --prefix pass2   # then hand THAT page over

node "$SKILL/scripts/version-areas.mjs"      # every area by release train
node "$SKILL/scripts/cross-areas.mjs" a.json b.json   # two axes crossed (optional)
node "$SKILL/scripts/merge-areas.mjs"        # codebook + probe side by side (optional)
```

**The first clustering is a stage, not a result.** Its job is to show which piles say
nothing, so they can be set aside. Everything you name, hand over, chart or report comes
from `pass2`. Never present the first pass's groups as findings, and never build the
dashboard on them.

### Two settings the optional steps need

Both live in `areas.json`, and neither is filled in for you. Set them when you reach the
step that uses them, and say so when you skip one — an empty column is not a finding.

- **`"splitVersion"`** turns the release comparison on. Run `version-areas.mjs` first, read
  which version the score breaks at, then write that version into `areas.json` and re-run
  `probe-reviews.mjs`. Left unset, the probe has no before and no after, and `merge-areas`
  prints no release table — it will tell you that is why.
- **`"codebookArea"`** links the two axes. `merge-areas.mjs` prints the clustered count
  beside the searched one and joins them on the **area name**. The names typed on the
  review page almost never match the names in `areas.json` by accident, so either use the
  same names on both sides or add `"codebookArea": "<the name from the page>"` to the
  matching area. When nothing joins, the script prints both lists of names and the line to
  add. Areas with no counterpart can stay unlinked — a search area that never won a group
  of its own is a finding in itself.

### Before the collection: say how long it takes

**Tell the user before starting `fetch-reviews.mjs`** that it can take a long time and that
a quiet terminal is normal. Google Play serves 150 reviews a page with a pause between
pages, which works out to **roughly a minute for every 5,000 Play reviews**. A small app over
six months takes a few minutes; an app with hundreds of thousands of reviews takes **an hour
or more**. The collector prints a progress line about every half minute; tell the user
that is what to watch. Run it in the background and say so. Without this warning, a
first-time user watches a slow terminal and decides it has hung.

When it finishes, it prints the **dates the App Store reviews actually cover**. Repeat that
line to the user. For a busy app it will be a few days, not the window asked for.

**Clustering and search are opposite tools and you need both.** Clustering answers *"what
is big in here?"* — it must place every review, so a theme smaller than about one k-th of
the corpus is absorbed into its nearest neighbour. That is what clustering *is*, not a bug
in it. Search answers *"is X in here at all?"* — you name the areas, it reports each count
**including zero**. Clustering misses what is small; search misses what you did not think
to ask.

**The number of groups is set from the number of reviews** — about 250 reviews per group,
never fewer than 32 — and the script prints the smallest theme that can still win a group.
Do not pass a number unless you have a reason. A fixed 32 was tuned on 7.8k reviews; on
Duolingo's 18k it left subscription complaints (1,225 reviews by search) without a group of
their own. At the 72 the rule gives, subscription, "doesn't work", "waste of time" and AI
complaints each got a group.

### Naming the clusters

**Name the second pass, not the first.** The first pass exists to find the piles that say
nothing; run the search and `drop-noise.mjs` before naming anything, then name the groups in
`out/pass2-clusters.json`. Naming the first pass wastes the work: those ids do not survive
the second run.

**Do this yourself — do not make the user name every group.** Read each group's top terms
and samples, name it, and propose an area for it; groups given the same area are merged.
Write that to `out/group-names.json` (the format is at the top of `name-groups.mjs`) and run
`name-groups.mjs group-names.json --prefix pass2`. It rebuilds the review page with your
names and areas filled in. Without it, the page shows raw top words and your names never
reach the user.

**Then stop and hand it to the user. Build nothing on the groups until they have reviewed
them.** This is a checkpoint, as firm as the defect-or-decision one below. A test session
named all the groups itself and went straight to the dashboard; the review page was built
and never mentioned. In one message:

1. Give the **full path** to `out/pass2-label-clusters.html`. Double-clicking it works.
2. Say your names and areas are already on the page, ready to correct.
3. Say what to do there: rename, move groups between areas (same area = merged), tick
   *needs split*, then press **Export codebook** and move the downloaded
   `<slug>-codebook.json` into `out/`.
4. Point out any group you filed as praise or noise whose **average rating or one-star share
   looks like a complaint**. That is where misfiled complaints hide. On Duolingo the biggest
   group of all (1,567 reviews) was filed as praise at a 3.22 average with 28% one-star.

Then wait for the export.

**How many groups survive depends on the app — and this is why grouping runs twice.** On a
FIRST pass over the reference app, out of 32: 8 clean single topics, 4 holding two crowds,
6 pure emotion, 13 vague, 1 split by language. On a well-liked app (Duolingo, at 32) only
**5** survived: 26 groups, holding 78% of the reviews, were praise with no topic. After the
second pass on the reference app, 22 of 24 groups were topics the keyword search recognises.
Tell the user that the first grouping throws most of its groups away — a happy app throws
away more — and that the numbers they will see come from the second one.

**Then say what clustering missed.** Take the biggest complaint areas from the keyword
search (`out/area-probe.json`) and name the ones that got no group of their own. On Duolingo
at 32 groups, subscription & billing (1,225 reviews), bugs (657), support (192) and login
(161) got none, while praise filled 26 slots. Clustering finds the loud topics; the search
finds what you asked about. Report both.

### Grouping runs twice — and the second run is the analysis

**This is the default method, not a refinement of it.** Emotion is not noise around the
signal in a review corpus, it *is* the bulk of it, so on a first pass it wins most of the
groups — 6 of 32 on the reference app, 26 of 32 on a well-liked one. Lowering k does not
fix that; it only costs resolution. So: group once to find the piles that say nothing, set
those aside, and group again.

```bash
node "$SKILL/scripts/drop-noise.mjs"                    # propose: nothing is written
node "$SKILL/scripts/drop-noise.mjs" --auto             # or --groups 0,3,5, or --area "No content"
node "$SKILL/scripts/cluster-reviews.mjs" --exclude out/drop-ids.json --prefix pass2
node "$SKILL/scripts/name-groups.mjs" group-names.json --prefix pass2
```

`--auto` needs no human input: it takes every group the keyword search recognises in under
a quarter of its members. Use `--area` instead when a person has already filed the first
pass's groups and you want their judgement rather than the threshold.

**The rule is: drop a review only when NEITHER method finds a topic in it.** Clustering
put it in a group that says nothing, *and* the keyword search matches none of your areas.
Anything either method recognises stays. `drop-noise.mjs` enforces that — you hand it
groups, it hands back only the members the search cannot see, and it prints both piles
with three examples each before it writes anything.

**Then stop and show the person what is about to be set aside.** This is a checkpoint, not
a status line: they are the only one who can tell you that the "contentless" pile is full of
ordinary complaints in a dialect your word list missed. In one short message give them the
two piles as the script prints them — how many, each pile's average rating, one-star share
and median length, and three real examples from each — and wait for a yes before grouping
again. What you are asking is: *"does the set-aside pile really say nothing, and does the
kept pile look like complaints?"*

Two things make the answer obvious when it is wrong. The kept pile should be clearly
**angrier and longer** than the set-aside pile; if it is not, the search terms are wrong.
And the set-aside pile should be a large share of the corpus but not most of it — the script
warns past 60%. A search that recognises almost nothing turns this step into "delete the
complaints", so treat a suspicious split as a vocabulary problem and go back to
`out/area-probe.html` rather than proceeding.

**Never drop a whole group, however obviously it is venting.** On the reference app the
group a person had filed as praise-and-venting held 4,066 reviews, and the search found a
real topic in **1,240** of them — 2.37 average, 58% one-star, 290 of them detailed
complaints over 120 characters. They had been filed as venting because their *vocabulary*
is angry ("thieves", "scammers", "they steal the balance"), not because they say nothing.
Dropping the group whole deleted **billing and trust** — 831 reviews by search, 1.88
average, 73% one-star, the second-largest problem area in the corpus — from the topic map
completely. It owned no group before the second pass and three after it.

What the second pass bought on that app, measured by how much of each group the
independent keyword search recognises:

| | groups | search recognises | groups it barely recognises |
|---|---|---|---|
| first pass, k=32 | 32 | 47% of reviews | 6 (1,037 reviews, averaging 3.7–4.6) |
| drop the group whole | 24 | 65% | 0 — but billing is gone |
| **drop only what neither sees** | 24 | 74% | 0 |

**The set-aside reviews stay in every denominator.** "Half of substantive reviews carry no
topic at all" is a finding about the channel, and a sharper topic map must not hide it. The
headline numbers — both store averages, the written-review average, the release comparison —
are computed over the whole corpus exactly as before. What the second pass changes is only
which reviews get grouped into topics.

**One report, from the second pass.** Do not publish the first pass's groups anywhere, and do
not build a page that sets the two passes side by side unless the person asks for that
specifically: it puts the method in front of the findings, and the reader has to work out
which numbers are live. Report the areas, the counts and the release comparison from
`pass2`, and say in the method section that grouping ran twice and why.

Two more things to say out loud. The group ids from the second pass are new — a codebook
exported against the first pass does not carry over. And the search rescues a few reviews it
should not, because a complaint word can appear in a compliment; that is the cheap side of
the trade, and the examples in the output make it visible.

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
- **Apple's feed stops at 500 reviews at most** (10 pages of 50), whatever window you ask
  for, and sometimes far fewer. The limit is on **how many, not how far back**, so how much
  time it covers depends on the app. The first app got 100, covering four and a half of
  the six months asked for (26 March to 7 August). Duolingo got the full 500, and they covered **three days**
  (12–15 September) against Play's 180. **Always report the date range actually obtained, not
  the one requested**, and when it is much shorter, say that the iOS numbers describe only
  that stretch and cannot be compared with Play over time.
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
- **Group twice.** The first grouping finds the piles that say nothing; the reported grouping
  is the second one, over the corpus with those reviews set aside. A first-pass group is never
  a finding. See "Grouping runs twice" above for the rule and what it costs to get it wrong.

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
- **Write the break back into `areas.json` as `"splitVersion"`.** Finding it in
  `version-areas.mjs` output is not the same as telling the other scripts about it. Until
  it is in the file, the probe splits nothing and every before/after in the pack is missing.
- **State the caveat every time:** users are not randomly assigned to versions. People who
  update fast may differ from people who do not.

## The dashboard

Build from `$SKILL/templates/dashboard.html` — copy it into the user's folder first, and
edit the copy. Replace the data arrays near the top of its script
(`MONTHS`, `TRAINS`, `KINDS`) and the tile and table numbers in the markup. Keep the shape:

1. **Tiles** — store score, written-only score, the other store, % saying nothing, break version
2. **Monthly lines** — all reviews against written only, gap shaded. **One store only**, the
   one with the volume; the other store's score goes in a tile and is never averaged in
3. **Release bars** — score per release train, break line marked
4. **Horizontal bars** — the areas by volume, red above 60% one-star
5. **Dumbbell** — before and after the break, sorted by how far each fell
6. **Sparklines** — each area across releases, grey comparison line behind
7. **Three small panels** — the two-way count check, what the channel cannot see, questions for analytics
8. **Method** — grouping ran twice and why, and how the areas were named

**The areas are the second pass's areas** (from the codebook the person exported against
`pass2`), so each review sits in exactly one and the counts sum. Say that under the bars —
and if you also show keyword counts anywhere, say those overlap and must not be added. One
page, one pass: do not put the two passes side by side unless the person asks for a
comparison.

Chart rules: **one y-scale per chart, never two** — rating and percentage in one frame can
be made to show almost any relationship. Numbers at 17px. Colours from CSS tokens so a theme
change redraws. Counts inside bars where they fit. Check every label position by arithmetic;
the geometry is hand-written and there is no layout engine to catch a collision — a row label
longer than its track runs off the frame, and an area with one scorable release must not be
drawn as a trend.

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
