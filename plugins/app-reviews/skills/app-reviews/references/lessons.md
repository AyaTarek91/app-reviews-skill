# The failure catalogue

Every entry here was a confident, plausible, wrong answer produced by this pipeline before
it became a rule. They are recorded with their real numbers because the numbers are what
made each one believable.

---

## 1. The Wi-Fi bug that was a design decision

**What was nearly shipped:** "Group #20 is a specific, reproducible app bug — the app fails
on Wi-Fi and only works on mobile data. 253 reviews. The most concrete, most fixable thing
in the whole dataset."

**What was true:** the app is **mobile-data-only by design** — zero-rated, consuming no
data allowance, and it needs the carrier connection to identify the SIM. It is *meant* to
fail on Wi-Fi. Wrong on cause.

**And wrong on size.** Only **136 reviews in the entire corpus mention Wi-Fi at all**, so a
253-member group was never all Wi-Fi complaints. Group size had been read as theme size.

**The rule:** review text cannot distinguish *"this is broken"* from *"this works as designed
and users hate it."* Ask someone who knows the product before writing up any theme as a
defect. This is the single strongest argument for treating reviews as one input rather than
the answer.

**What survived, as a hypothesis only:** 6 reviews report the failure on mobile data too,
which the design does not explain — including one describing a contradictory loop ("on Wi-Fi
it says turn on mobile data; on mobile data it says no internet"). Small, unconfirmed, a
question for analytics.

---

## 2. The 192 font complaints that were all wrong

**The search:** `خط`, expecting complaints about font and text size.

**The result:** 192 hits. Clean, plausible, and entirely false. In Egyptian Arabic `خط`
means **phone line**, and it also sits inside `الخطأ` — "the error".

**The rule:** never report a count without the words that produced it and real examples of
each. The probe page shows per-term counts for exactly this reason; do not "simplify" it to
an area total.

---

## 3. The 868 feature requests that were bug reports

**The search:** the polite-request words — `ارجو`, `رجاء`, `برجاء`, `نرجو`, `نفسي`.

**The result:** 868 hits, and every one wrong. `ارجو حل المشكلة` means "please **fix** this"
— a bug report, not a request for something new.

**Worse:** `برجاء المحاولة في وقت لاحق` is **the app's own error message** ("please try
again later"). 122 of those hits were users quoting a failure back at us, counted as
requests for new features.

**The fix and how it was confirmed:** narrowing to genuine markers — "I wish", "I hope",
"suggestion" — cut the area to 372 and moved its average rating from 2.87 to **3.24**, with
one-star share falling 43% to 33%. **Requests come from happier users.** That shift is the
signature of a correct list. If your feature-request area scores like the other areas, the
terms are still wrong.

**The rule:** a politeness word is not an intent word. And always check whether a candidate
phrase appears in the app's own UI strings.

---

## 4. The wrong version got blamed for four months

**The suspect:** `2026.7.1`, because it carried 720 written reviews in July, the
worst-scoring month.

**It was innocent.** It was merely the most-installed build during the bad period. It
inherited the problem.

**The real break was `2026.4.3`,** released three weeks earlier. Every version before it
averaged 3.0–3.6 with 28–43% one-star; every version from it onward averaged 1.7–2.5 with
58–73% one-star. No exceptions on either side.

**How it was proved.** Comparing people on old builds against people on new builds *within
the same calendar month*:

| Month | Old build | 1★ | New build | 1★ |
|---|---|---|---|---|
| Apr | 3.48 | 30% | 2.21 | 64% |
| May | 3.27 | 36% | 2.20 | 63% |
| Jun | 3.11 | 40% | 2.23 | 62% |
| Jul | 2.38 | 54% | 1.96 | 68% |
| Aug | 3.25 | 33% | 2.32 | 62% |

Same month, same news, only the build differs — and the gap exceeds a full star in all
five. Calendar time does not explain it.

**The rule:** volume on a version is not evidence about that version. Split on version
inside a fixed time window, or you are measuring popularity.

**The caveat that must always travel with it:** not a randomised test. Fast updaters may
differ from slow ones. And in July the old-build group *also* fell, so a smaller external
effect sits on top of the release effect.

---

## 5. The anomaly review data cannot resolve

At the break, **every topic got worse — no exceptions.** But *network and coverage*
complaints rose 28 points, and **an app release cannot degrade a mobile network.**

Two readings, and reviews cannot separate them:

- **(a)** something in the release broke a core path that every screen depends on, so every
  topic's reviews got angrier; or
- **(b)** the population writing reviews changed after that build.

The differential argues for (a) — a pure population shift would move everything equally,
and the range here was 33 points down to 8. But it does not settle it.

**The honest handoff:** compare crash-free rate and funnel completion for the build before
against the build after. **Degraded funnels mean (a). Flat funnels mean (b).** Do not assert
either without it.

---

## 6. Nine of thirty groups formed on mood

With verdict words left in the text, clustering produced a "praise" group and a "venting"
group instead of product areas — nine slots spent on feelings the rating column already
records.

**The line that works:** a word saying how it *was* goes (`bad`, `excellent`, `rubbish`); a
word saying what *happened* stays (`slow`, `error`, `deducted`, `thieves`).

**And the leftovers are a finding.** 156 reviews were long enough to look substantive but
contained only verdict words. Their average was **4.47** — far above the corpus. Report them
as their own bucket.

---

## 7. Fewer groups did not mean less noise

**The assumption:** if 32 groups produce a lot of junk, use fewer.

**Tested at k=10 on the same 7,773 reviews.** Praise still occupied **3 of the 10 slots** —
the noise survived, because noise is a large share of the corpus and survives any cut. What
was destroyed was resolution: *update* got welded to *login*, and *balance*, *bundles* and
*recharge* collapsed into one blob.

**The rule:** k controls how finely the corpus is cut, not how many real topics exist. Set
it high, expect junk, discard by hand. Merging two piles is typing the same name twice;
un-merging is impossible.

**The other direction, found on the second app:** "high" is relative to the corpus. Duolingo
clustered 18,058 reviews at the same k=32, so the smallest group held 263 and anything
smaller could not get a group. The user kept 5 of the 32; praise filled 26. Subscription
complaints — 1,225 reviews by search, bigger than any group kept — had no group, nor did
bugs, support or login. Re-run at k=72 (about 250 reviews per group), a subscription group
appeared, along with "doesn't work", "waste of time" and AI complaints. **k is now set from the
corpus size by default**, never below 32, and the script prints the smallest theme that can
still win a group.

---

## 8. Adding overlapping counts inflated a number by 40%

Five small themes were folded into one area at the user's request: accessibility (4),
navigation (45), ads (56), language (40), security (45).

**Adding them gives 203. The merged search returns 145.** The 58-review difference is people
whose review matched two of them.

**The rule:** areas overlap by design. Merge by putting the terms in one list and searching
once — never by adding counts. On this corpus 1,043 reviews matched more than one area.

---

## 9. The two-scale chart

The release chart was first drawn with average rating and one-star share sharing one frame
on different y-axes. Two scales in one plot can be positioned to show almost any
relationship, including ones that are not there.

**The rule:** one y-scale per chart. A second measure on a different unit goes in a label,
a tooltip, or its own chart.

---

## 10. Checking that the code ran is not checking that the answer is possible

The general rule underneath all of the above. After each step, test the output against
something independently reasonable:

- Does the date range match what was requested? (Apple's will not.)
- Does a second method agree? (Cluster count against search count.)
- Do the parts sum to a known total? (Clustered groups must; search areas must not.)
- Is the magnitude plausible against the denominator?

The strongest single check this pipeline has produced: **528 against 529** — clustering and
keyword search, sharing no logic, landing one review apart on the same area. Where two
methods diverge instead, take the smaller number and say which way they disagreed.

---

## 11. The tool wrote its own data into itself

Found by running the finished skill on a second app, in an empty folder, from a session
that knew nothing about the first app. The whole run appeared to work. The user's folder
stayed **completely empty** — `app.json`, `areas.json`, `node_modules/` and `out/` had all
been written into the skill's own directory instead.

It was not the session going off-script. The setup block said `cp scripts/app.example.json
scripts/app.json`, and every script resolved its paths from `import.meta.dirname`. The
session did exactly what it was told; the instructions were wrong.

Four consequences, and only the first is obvious:

1. The person who asked for the analysis cannot find it. Their folder is empty and the
   deliverable is under `~/.claude` where they will never look.
2. **The second app destroys the first.** `app.json` and `areas.json` are single-slot.
3. Every read and write is outside the working directory, so each one raises a permission
   prompt — which reads to a new user as the tool misbehaving.
4. **A plugin update replaces the skill directory.** Data kept there is destroyed by
   `claude plugin install`, including collections that took twenty minutes to fetch.

**The rule: the tool is read-only, the working directory is read-write.** Scripts and
templates live with the skill; config and output live where the user is. `workdir.mjs` is
the one place that decides this, so no script can drift back.

And the reason it went unnoticed: it was invisible from inside. Every test run until then
had been made from a session whose working directory *was* the project, where correct and
broken produce identical results. **A tool cannot test its own file layout from inside
itself** — that needs a run in an empty folder someone else owns.

The same run surfaced a second, quieter bug. Generalising the filename pattern from one
app to any app added a capture group at the front:

```
/^ana-vodafone-reviews_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})\.json$/
/^(.+)-reviews_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})\.json$/
```

Every group index shifted by one. Three scripts were updated; `cluster-reviews.mjs` was
not, so it computed its window span from the app's *name* — `Date.parse("ana-vodafone")`,
which is `NaN`. The sort silently fell through to the tie-breaker and picked the file with
the latest **start** date: the 30-day pull instead of the six-month one. No error, no
warning, a valid-looking clustering of a quarter of the data — the exact failure the
comment directly above it said it was there to prevent. **Adding a capture group renumbers
every group after it**, and the only defence is one shared implementation, which is now
`widestCombinedFile()`.
