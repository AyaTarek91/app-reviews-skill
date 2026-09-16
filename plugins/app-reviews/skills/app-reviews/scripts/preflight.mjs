// preflight.mjs — find out what this environment allows BEFORE collecting anything.
//
//   node preflight.mjs
//
// The collector needs two domains and one package. Whether it has them depends on
// the surface and on a setting the user may or may not be able to reach. Asking the
// docs gives an answer that is often wrong for the account in front of you, so this
// asks the network instead and prints which of the two modes you are in.
//
// Exits 0 either way. The verdict is the output, not the exit code.

import { WORK, loadPlayScraper } from './workdir.mjs';

const TARGETS = [
  { label: 'Google Play', url: 'https://play.google.com/store/apps/details?id=com.google.android.youtube&hl=en&gl=us', domain: 'play.google.com' },
  { label: 'App Store',   url: 'https://itunes.apple.com/search?term=maps&entity=software&limit=1',                    domain: 'itunes.apple.com' },
];

const line = (s = '') => console.log(s);
const ok = (s) => `  [ok]      ${s}`;
const no = (s) => `  [BLOCKED] ${s}`;
const warn = (s) => `  [missing] ${s}`;

line();
line(`Node ${process.version}  ${process.platform}`);
// Say the work directory out loud. Config is read from here and every result is
// written here, so if it is not where the person expects, this is the moment to
// find out — not after a twenty-minute collection lands somewhere else.
line(`Working in ${WORK}`);
line();

// Resolved from the work directory first, the same way fetch-reviews.mjs does
// it, or this would report "installed" for a package the collector cannot see.
const pkg = (await loadPlayScraper()) !== null;
if (pkg) {
  line(ok('google-play-scraper is installed'));
} else {
  line(warn('google-play-scraper is NOT installed  ->  npm install google-play-scraper'));
}

const reach = {};
for (const t of TARGETS) {
  try {
    const res = await fetch(t.url, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': 'Mozilla/5.0 (preflight)' },
    });
    // A reply of any kind means egress reached the host — even a 403 or 404 proves the
    // connection was allowed. Only a transport error, caught below, means blocked.
    reach[t.domain] = true;
    line(ok(`${t.domain} reachable (HTTP ${res.status})`));
  } catch (err) {
    reach[t.domain] = false;
    line(no(`${t.domain} — ${err.cause?.code ?? err.name ?? 'unreachable'}`));
  }
}

const netOk = TARGETS.every((t) => reach[t.domain]);

line();
if (netOk && pkg) {
  line('  VERDICT: full pipeline. Collect, then analyse.');
} else if (netOk && !pkg) {
  line('  VERDICT: full pipeline once the package is installed. Run the npm install above.');
} else {
  line('  VERDICT: ANALYSIS ONLY. The store domains are not reachable from here, so');
  line('  find-app.mjs and fetch-reviews.mjs cannot run. Two ways forward:');
  line();
  line('  1. Ask the user to allow egress to these two domains:');
  for (const t of TARGETS) if (!reach[t.domain]) line(`       ${t.domain}`);
  line('     On a personal plan:        Settings > Capabilities > Allow network egress');
  line('     On Team or Enterprise:     Organization settings > Capabilities — only an');
  line('                                organization OWNER can add specific domains.');
  line('     If they are not an owner, this route needs someone who is. Say so plainly');
  line('     rather than leaving them clicking around their own settings.');
  line();
  line('  2. Ask them to upload a reviews file collected earlier in Claude Code — the');
  line('     combined JSON or CSV. Then skip to cluster-reviews.mjs. The five analysis');
  line('     scripts need no network and no packages, so this always works.');
}
line();
