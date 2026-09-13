// Find an app's store ids from its name, so nobody has to paste links.
//
//   node find-app.mjs "spotify" eg
//   node find-app.mjs "ana vodafone" eg
//
// Prints candidates from both stores. It does NOT pick one — the top hit is
// often the wrong app ("Spotify for Artists", a clone, a regional fork), and
// analysing the wrong app produces a clean, plausible, entirely wrong report.
// Show the list, confirm with the person, then write app.json by hand.

const [term, country = 'us'] = process.argv.slice(2);
if (!term) {
  console.error('Usage: node find-app.mjs "<app name>" [country]   e.g. node find-app.mjs "spotify" eg');
  process.exit(1);
}

const line = (s) => console.log(s);

// --- App Store -------------------------------------------------------------
// Apple's public search endpoint. No key, no scraping.
try {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}` +
    `&country=${encodeURIComponent(country)}&entity=software&limit=5`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const json = await res.json();
  line(`\nApp Store (${country}) — iosId is the number:`);
  if (!json.results?.length) {
    line('  nothing found. The app may not be published in this storefront.');
  } else {
    for (const a of json.results) {
      line(`  ${String(a.trackId).padEnd(12)} ${a.trackName}`);
      line(`  ${''.padEnd(12)} by ${a.sellerName} · ${a.averageUserRating?.toFixed(2) ?? '?'} stars · ${a.userRatingCount ?? 0} ratings`);
    }
  }
} catch (err) {
  line(`\nApp Store lookup failed: ${err.message}`);
}

// --- Google Play -----------------------------------------------------------
try {
  const gplay = (await import('google-play-scraper')).default;
  const res = await gplay.search({ term, country, lang: 'en', num: 5 });
  line(`\nGoogle Play (${country}) — androidId is the package name:`);
  if (!res.length) {
    line('  nothing found.');
  } else {
    for (const a of res) {
      line(`  ${a.appId}`);
      line(`  ${''.padEnd(2)}${a.title} · by ${a.developer} · ${a.scoreText ?? '?'} stars`);
    }
  }
} catch (err) {
  line(`\nGoogle Play lookup failed: ${err.message}`);
  line('  (if this says "Cannot find package", run: npm install google-play-scraper)');
}

line(`
Now write app.json. Check the DEVELOPER name matches on both stores before you do —
the two stores are being joined on your judgement, not on any shared id, and pairing
two different companies' apps produces a report that looks completely normal.`);
