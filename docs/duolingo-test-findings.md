# Duolingo test run — findings

**Run:** 16–21 September 2026. The `app-reviews` skill was pointed at **Duolingo (US)** from an
empty folder (`C:\Users\Ghammry\duolingo-test`) by a Claude session that knew nothing about the
Ana Vodafone reference project. The person running it played a first-time user.

**Why this run mattered:** every earlier run was on Ana Vodafone, from inside the project the
tool was built in. There, the tool's folder and the user's folder are the same place, and the
defaults were written for that one app, so a whole class of bugs looks like correct behaviour.
A second app, run from somewhere else, was the only way to see them.

**Data collected:** 180 days (20 March – 16 September 2026). 331,970 Google Play reviews and 500
App Store reviews. The analysis used an English-only subset: 26,575 reviews, of which 19,071
have real text (more than 30 characters) and 18,058 were clustered.

---

## What worked

- **The self-check passed.** The skill says a correct feature-request list must score higher
  than every other area, because requests come from people who still like the app. On Duolingo,
  *Course & feature requests* averaged **4.05 stars with 6% one-star**, the best of all ten
  areas by a clear margin. This was an app the method was never tuned on, using the untested
  English word lists, so it is the best evidence so far that the method carries over.
- **The dashboard was named and placed correctly:** `dashboards\duolingo-us-dashboard.html`.
- **The session asked the defect-or-decision question** before calling anything a bug, and the
  user marked *energy limit* and *ad volume* as intended design, not defects.

---

## Findings

Ordered by how badly each one hurts a first-time user.

### 1. The skill wrote everything into its own folder — FIXED

**What happened:** `app.json`, `areas.json`, `node_modules/` and `out/` all landed in the skill's
install folder under `~/.claude/skills/`. The user's folder stayed empty, and every file access
raised a permission prompt for a path outside the project.

**Why it matters:** the user can't find their own analysis. A second app overwrites the first
app's settings. Installing or updating the plugin replaces the folder and deletes the collected
data.

**Fix:** `scripts/workdir.mjs`. The tool's folder is read-only, the current folder is where work
happens, `APP_REVIEWS_DIR` overrides it, and `preflight.mjs` prints the folder it chose. Commit
`15c3477`, pushed. A bug found while fixing it: `cluster-reviews.mjs` was silently reading the
30-day file instead of the 6-month one. That is fixed in the same commit.

### 2. The clusters were never shown to the user — FIXED

**What happened:** the session named the 32 groups itself, as the skill says to do, and then
went straight to the dashboard. `label-clusters.html` was built and never mentioned. The user
only reviewed the groups because they asked.

**What the skill says:** *"Do this yourself — do not make the user name 32 groups … Then show the
user the result and ask them to correct anything wrong."* The session followed the first
sentence and skipped the second.

**A second problem under it:** even if the session had shown the page, its names would not be
on it. The review page shows each group's raw top words ("don / words / doesn"), and there is no
way to pass in the names the session chose. So the session's work and the user's review happen
in two places that never meet.

**Proposed fix:** make the review a hard stop in SKILL.md, worded like the defect-or-decision
checkpoint: give the full path, say what to do on the page, and wait for the export. Let
`cluster-reviews.mjs` take a file of suggested names so the page opens pre-filled with the
session's names instead of raw words.

### 3. 32 groups is too few for this many reviews — FIXED

**What happened:** the skill treats 32 groups as a fixed number. That number was tuned on Ana
Vodafone's 7,773 reviews. Duolingo had 18,058 clustered, so the average group held 564 reviews
and the smallest held 263. Any theme smaller than about 263 reviews could not get a group of its
own.

**What the user found when reviewing:** they kept **5 real topics out of 32**, not the 8 the
skill promises. 26 groups, **78% of the clustered reviews**, were praise with no topic ("fun,
helps me learn"). The complaint themes the keyword search found were missing from the groups
entirely:

| Area found by keyword search | Reviews | Got its own group? |
|---|---|---|
| Subscription, price & billing | 1,225 | no |
| Reliability & bugs | 657 | no |
| Customer support | 192 | no |
| Account, login & lost progress | 161 | no |

Subscription is bigger than every group the user kept.

**Two groups the user filed as praise score like complaints:** #21 ("don / words / doesn",
1,567 reviews, 3.22 average, 28% one-star, words include *doesn't, work, teach*) and #13
("free / version / trial", 513 reviews, 3.57 average, words include *subscription, paid*).
Subscription complaints most likely landed in #13. Not yet resolved by the user.

**Also:** `cluster-reviews.mjs` defaults to **30** groups when no number is given, while
SKILL.md talks about 32 throughout.

**Proposed fix:** set the number of groups from the number of reviews (for example, aim for
about 250 reviews per group, with a minimum of 32) and print the smallest theme that can still
win a group. Replace "expect 32, keep 8" with a range, and say that the share of praise depends
on the app: a happy app like Duolingo spends most of its groups on praise. Tell the session to
check the keyword search's biggest complaint areas against the groups and say which ones got no
group.

### 4. The review page still has Ana Vodafone built into it — FIXED

**What happened:** `templates/label-page.html` was never made general.
- A button reads **"Add suggested telco areas"** and adds *Recharge & Top-up, Vodafone Cash,
  Flex, Red, Offers & Bundles* and so on.
- A preset area is called **"Not the app (network / pricing)"**, which only makes sense for a
  phone carrier.
- Each group card shows **"Feb → Aug"** under its monthly trend, a fixed label. Duolingo's data
  runs March to September.

**Why nobody saw it:** every earlier run was on Ana Vodafone, where all three are correct.

**Proposed fix:** take the suggested areas and the "not the app" label from `app.json`, with an
empty default. Build the month label from the months in the data.

### 5. The export filename can pick up the wrong app's file — FIXED

**What happened:** the page always saves as `axis-a-codebook.json`. The Downloads folder already
held Ana Vodafone's codebook from 4 September, so the browser saved Duolingo's as
`axis-a-codebook (1).json`. A script looking for `axis-a-codebook.json` in Downloads would have
read the **other app's** codebook without any warning.

**Proposed fix:** put the app's name in the filename (`duolingo-us-codebook.json`) and have
`merge-areas.mjs` check that the codebook's `source` field matches the reviews file. It already
refuses a mismatch; the filename just needs to stop inviting one.

### 6. The session wrongly decided the package couldn't be found and copied the tool — FIXED (text)

**What happened:** the session said the scripts, installed on drive E:, could not find
`google-play-scraper` installed in the user's folder on drive C:. It copied `scripts\` and
`templates\` into `duolingo-test\` and ran them from there.

**This was wrong.** Running the skill's own `preflight.mjs` from E: with the user's folder as the
working folder printed `[ok] google-play-scraper is installed`. `workdir.mjs` looks for the package
in the user's folder first, which works across drives. The session was describing how things
worked *before* fix 1.

**Why it matters:** the user now has two copies of the tool. The copy will not get fixes, and
nothing says it has gone out of date.

**Proposed fix:** two lines in SKILL.md: preflight's `[ok]` line is the answer on whether the
package is found; never copy the scripts into the user's folder, run them where they are
installed.

### 7. Nothing says how long collection takes — FIXED

**What happened:** the 180-day collection took many minutes with a quiet terminal. One earlier
session warned the user without being told to; this one did not. The warning happens only when
a session thinks of it, because the skill does not mention it.

**Proposed fix:** tell the session to say, before starting, roughly how long it will take and
that a quiet terminal is normal. Have `fetch-reviews.mjs` print progress lines for Google Play
often enough that it never looks frozen.

### 8. "Apple caps at about 100 reviews" is wrong — FIXED

**What happened:** the App Store returned **500 reviews**, all dated **12–15 September 2026:
3 days**. Google Play gave 331,970 over the full 180 days.

**The correct rule:** Apple's feed stops at about 500 reviews (10 pages of 50). The cap is on
**how many**, not **how far back**. For a busy app, 500 reviews cover a few days. For a quiet
app, like Ana Vodafone with 83, they can cover months. So for a busy app the iOS numbers
describe **a few days**, not the requested window, and cannot be compared with the Play numbers
over time.

**Where the wrong rule lives:** SKILL.md line 208 and the Ana Vodafone project's CLAUDE.md
("Apple caps at ~100 reviews total"). `fetch-reviews.mjs`'s own comment already says about 500.

**Proposed fix:** correct both places. Have the collector print the date range Apple actually
covered next to the requested window, and warn when it is less than a tenth of it.

---

## Gap, not a bug: no language filter

The skill has no way to analyse one language at a time. For Ana Vodafone that never mattered:
95% of reviews were Arabic. Duolingo's reviews came in through 30 language settings, and
clustering them together would group by language, not topic. The session built a separate
English-only folder (`analysis-en\`) with its own `app.json` and `areas.json`. That was a
sensible choice, but it had to be invented, and a less careful session would have clustered
the mix.

**Proposed fix:** a `language` option in `app.json` that the analysis scripts apply to the
review text, plus a line in SKILL.md: check the language mix first, and analyse each big
language separately.

---

## Still to check

- **Is the `areas.json` step stable?** Compare this run's `areas.json` with the first attempt's,
  saved at `C:\Users\Ghammry\duolingo-keep\areas-run1.json`. If two sessions write very different
  word lists for the same app, the keyword search numbers depend on which session you got.
- **Groups #21 and #13:** waiting on the user to decide whether they are complaints.
- **Keyword-search coverage is 31%** (5,891 of 19,071 reviews matched at least one area),
  against 46% on Ana Vodafone with hand-tuned Arabic word lists. That's expected for untuned
  lists, and the dashboard must report it. It is not a bug.

---

## Fix pass, 21 September

What was changed for each finding, and how it was checked.

- **2. Groups never shown:** SKILL.md makes the review a hard stop. New `name-groups.mjs` reads
  the session's names and proposed areas from `out/group-names.json` and rebuilds the page
  with them filled in. It refuses a names file written for a different run (a different
  source file or group count), because group ids are positions in one run. Tested: a names
  file for k=32 against a k=72 run is refused with both runs named.
- **3. Group count:** `cluster-reviews.mjs` now sets the count at about 250 reviews per group,
  between 32 and 120, and prints the smallest theme that can still win a group. Tested on
  both apps. **Ana Vodafone** still gets 32, and its `clusters.json` is **identical** to the
  saved reference. **Duolingo English** gets 72, and a subscription group appears (274
  reviews, 2.61 average, 43% one-star), along with "doesn't work" (377), "waste of time"
  (356) and AI complaints (302, 2.77 average), none of which had a group at 32. Runs in 25
  seconds.
- **4. Ana Vodafone in the page:** telco button and its 15 areas removed. The preset area is
  now "Not about the app". The month label and trend bars come from the data ("Mar → Sep"),
  with empty months shown as gaps. Saved edits are keyed to the source file *and* the group
  count, so re-clustering at a new count cannot reload the old run's edits onto different
  groups.
- **5. Export filename:** now `<slug>-codebook.json` (`duolingo-us-en-codebook.json`).
  `merge-areas.mjs` looks for that name first and the old `axis-a-codebook.json` second, and
  says where it looked when it finds neither.
- **6. Copying the tool:** SKILL.md text only: believe preflight's `[ok]`, never copy the
  scripts.
- **7. Collection time:** SKILL.md warns before the fetch starts. `fetch-reviews.mjs` prints a
  progress line every 20 pages. Tested live: two lines in 75 seconds, at about 6,000 reviews
  a minute, which matches the estimate in SKILL.md.
- **8. Apple:** corrected in SKILL.md, the collector's comment and the Ana
  Vodafone CLAUDE.md. `fetch-reviews.mjs` now prints the dates the App Store reviews cover
  against the days asked for, and warns when that's under a tenth of the window. **Not tested
  live:** the App Store returned no reviews at all during the test (see below).

## Found during the fix pass

- **9. `merge-areas.mjs` crashed on an area with no reviews — FIXED.** The user's codebook
  kept the preset "Not the app" area empty, and printing its rating (`null`) threw. Ana
  Vodafone never had an empty area, so it never showed. Every rating print now shows "—"
  when there is none.
- **10. `merge-areas.mjs` still assumes the Ana Vodafone setup — OPEN.** On Duolingo it prints
  "Split at version null", and every area reads "no search equivalent". It joins the
  codebook to the search through a `codebookArea` field in `areas.json` that nothing tells
  the session to fill in, and it expects a known break version. It is marked optional in
  the pipeline, but it should say what it needs instead of printing a table of dashes.
- **11. The stores behaved differently on 21 September — OPEN, not investigated.** A 4-day
  English-only Play fetch got nothing in the window: the newest review returned was dated
  10 September, where the same collector reached 16 September five days earlier. The App
  Store returned no rows from any URL shape. The change being tested only adds print lines,
  so this comes from the stores' side (possibly throttling after the 330k-review pull).
  Worth re-checking before the next full run.
