# app-reviews

A Claude skill that turns App Store and Google Play reviews for any app into a one-page
dashboard a manager can read: the real score behind the store rating, which release broke
it, and what kind of trouble people actually report.

Works on any app in any storefront. You give it an app name and a country; it resolves the
store ids itself.

## What it is honest about

Reviews record **issues with what already exists**. They are not needs. This skill produces
one discovery input among several — hypotheses and questions, never a backlog.

- **Strong for:** regressions tied to a release, ranking existing friction by volume and
  anger, and the words customers actually use.
- **Blind to:** unmet needs, silent churn, people who never installed, mild dissatisfaction,
  and absolute size (n complaints out of an unknown denominator).

Every finding it writes carries a confidence label and names the source that would settle
it. It never states a review-derived count as a measured user need.

The method's strongest move is the **within-month version comparison**: compare people on
an old build against people on a new build *inside the same month*, which breaks the tie
between "the release did it" and "something happened that month". It needs only
`app_version` and `date`, which every store dataset has.

## Install

### Claude Code — as a plugin

```
/plugin marketplace add AyaTarek91/app-reviews-skill
/plugin install app-reviews@app-reviews-marketplace
```

Then `/app-reviews` in any project.

### Claude Code — by hand

```bash
git clone https://github.com/AyaTarek91/app-reviews-skill
cp -r app-reviews-skill/plugins/app-reviews/skills/app-reviews ~/.claude/skills/
```

`~/.claude/skills/` makes it personal; `.claude/skills/` inside a repo makes it
project-scoped.

### claude.ai and Cowork — as a zip

```bash
node build-zip.mjs        # writes dist/app-reviews.zip
```

Upload it under **Customize → Skills**. The zip must have the skill *folder* at its root
(`app-reviews/SKILL.md`), which is what the builder produces — and with forward slashes,
which is why it writes the archive itself instead of calling `Compress-Archive`.

Skills do not sync across surfaces. A skill uploaded to claude.ai is not available in the
API, and Claude Code's filesystem skills are separate from both. Upload once per surface.

## What the environment has to allow

The collector reaches the network. Everything after it does not.

| | `preflight`, `find-app`, `fetch-reviews` | `cluster`, `probe`, `version-areas`, `cross-areas`, `merge-areas` |
|---|---|---|
| Needs the internet | **yes** — `play.google.com`, `itunes.apple.com` | no |
| Needs a package | **yes** — `google-play-scraper` | no, Node standard library only |

Run `node preflight.mjs` to find out which half you get. It tries both domains and prints
either **full pipeline** or **analysis only**, which is more reliable than reading the docs —
what an account actually allows varies.

- **Claude Code** — all of it works. Full network access, `npm install` is fine.
- **claude.ai / Cowork** — network egress defaults to **package managers only**, so
  `npm install google-play-scraper` succeeds but the two store domains are **blocked**.
  Either allow egress to those two domains, or upload a reviews file you already collected
  and use the analysis half, which needs neither network nor packages. On a personal plan
  the egress toggle is Settings → Capabilities; on Team or Enterprise it is Organization
  settings → Capabilities, and **only an organization owner can add specific domains** —
  so on a company account this is a request to someone else, not a setting you can flip.
- **Claude API** — no network and no runtime installs, so the analysis half only.

Node 24, ESM. One dependency, and only the collector needs it:

```bash
npm install google-play-scraper
```

## The pipeline

```bash
node preflight.mjs                 # what does this environment allow? run this first
node find-app.mjs "app name" eg    # resolve store ids from a name — always confirm the hit
node fetch-reviews.mjs 180         # collect. --ios-only reuses the saved Play pull
node cluster-reviews.mjs           # group by topic; group count set from review count
node name-groups.mjs               # put the session's names on the review page
node probe-reviews.mjs             # search named areas, reports zeros too
node version-areas.mjs             # every area by release train
node cross-areas.mjs a.json b.json # two axes crossed (optional)
node merge-areas.mjs               # human codebook + probe, side by side (optional)
```

**Clustering and search are opposite tools and you need both.** Clustering answers *"what
is big in here?"* — it must place every review, so anything smaller than about one k-th of
the corpus is absorbed into its nearest neighbour. Search answers *"is X in here at all?"* —
you name the areas and it reports every count including zero. Clustering misses what is
small; search misses what you did not think to ask.

## Layout

```
.claude-plugin/marketplace.json        the marketplace manifest
plugins/app-reviews/
  .claude-plugin/plugin.json           the plugin manifest
  skills/app-reviews/
    SKILL.md                           the skill itself
    scripts/                           preflight, collector, five analysis scripts
    templates/                         areas template, dashboard, two review pages
    references/lessons.md              the full failure catalogue
build-zip.mjs                          builds dist/app-reviews.zip for claude.ai / Cowork
```

`references/lessons.md` is the part worth reading even if you never run the skill. It is a
catalogue of wrong answers that looked right: a search term that meant "phone line" instead
of "font" and returned 192 clean, plausible, false hits; a politeness word that turned out
to be the app's own error message; a version string that sorted `2026.10.1` before
`2026.4.1` and silently reversed a timeline.

## Caveat on the defaults

`templates/areas.template.json` is an English template. The search vocabulary is the one
thing that cannot be generalised — it has to be written in the dialect your users write
reviews in, and a term that matches nothing usually means you guessed the wrong local word
rather than that the topic is absent. Check `out/area-probe.html` before trusting any count;
it lists every term with its hit count and real examples for exactly that reason.

## License

MIT. See [LICENSE](LICENSE).
