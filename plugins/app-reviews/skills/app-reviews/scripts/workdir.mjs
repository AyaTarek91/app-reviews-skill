// Where the tool lives, and where the work happens. They are not the same place.
//
// The scripts live in the skill folder. Everything that is about ONE app —
// app.json, areas.json — and everything produced — out/ — belongs to the PERSON,
// in the folder they are working in. Keeping the two apart matters for four
// reasons, each of which actually bit us:
//
//   1. Someone asks for an analysis in their own project and the data lands in a
//      hidden folder under ~/.claude they would never think to look in. Their
//      folder stays empty and the deliverable is somewhere else entirely.
//   2. app.json and areas.json are single-slot. Beside the script, analysing a
//      second app silently destroys the first app's configuration.
//   3. Every read and write outside the working directory raises a permission
//      prompt, which reads to a first-time user as "this tool is doing something
//      it should not be doing".
//   4. `claude plugin install` and plugin updates REPLACE the skill directory.
//      Anything kept there is lost on the next update, including collected data
//      that took twenty minutes to fetch.
//
// WORK is the current working directory. APP_REVIEWS_DIR overrides it, for when
// the analysis should not sit wherever the shell happens to be.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Read-only: scripts here, templates one level up. Never write to it.
export const SKILL = import.meta.dirname;
export const TEMPLATES = path.join(SKILL, '..', 'templates');

// Read-write: the person's folder. Config in, results out.
export const WORK = path.resolve(process.env.APP_REVIEWS_DIR ?? process.cwd());
export const OUT = path.join(WORK, 'out');

export const ensureOut = () => fs.mkdir(OUT, { recursive: true });

// Read a config file (app.json, areas.json) from the work directory. The error
// has to name the path it looked at and the command that fixes it: "no app.json"
// on its own sends people looking in the skill folder, which is the habit this
// module exists to break.
export async function readWorkConfig(name, copyFrom) {
  const file = path.join(WORK, name);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw new Error(`${name} is not valid JSON.\n  ${file}\n  ${err.message}`);
    }
    throw new Error(
      `No ${name} in the folder you are working in.\n` +
      `  Looked in: ${file}\n` +
      (copyFrom ? `  Create it:  cp "${path.join(SKILL, '..', copyFrom)}" "${file}"\n` : '') +
      `  (Set APP_REVIEWS_DIR to work somewhere other than the current directory.)`,
    );
  }
}

// The five analysis scripts all start from the same file: the widest date window
// in out/. Picking the WIDEST rather than the newest is deliberate — filenames
// sort by start date, so a 30-day pull made today sorts above a 6-month pull made
// last month and would quietly become the source.
export async function widestCombinedFile() {
  let entries;
  try {
    entries = await fs.readdir(OUT);
  } catch {
    throw new Error(`No out/ folder yet.\n  Looked in: ${OUT}\n  Run fetch-reviews.mjs first.`);
  }
  const files = entries
    .map((f) => f.match(/^(.+)-reviews_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})\.json$/))
    .filter(Boolean)
    .map((m) => ({ file: m[0], span: Date.parse(m[3]) - Date.parse(m[2]), end: m[3] }))
    .sort((a, b) => b.span - a.span || b.end.localeCompare(a.end));
  if (!files.length) {
    throw new Error(`No combined review file in out/.\n  Looked in: ${OUT}\n  Run fetch-reviews.mjs first.`);
  }
  return files[0].file;
}

// Templates ship with the skill, so they are read from there — but a copy sitting
// beside the script wins, which is how you try an edited template without
// touching the installed skill.
export async function readTemplate(name) {
  for (const dir of [SKILL, TEMPLATES]) {
    try { return await fs.readFile(path.join(dir, name), 'utf8'); } catch { /* try next */ }
  }
  throw new Error(`Template not found: ${name}\n  Looked in: ${SKILL}\n  and: ${TEMPLATES}`);
}

// `npm install google-play-scraper` runs in the folder the person is working in,
// so that is where the package will be. A bare import resolves from THIS file
// instead, walking up from the skill folder, and would miss it — which is how you
// get "missing dependency" immediately after a successful install. Try the work
// directory first, then fall back to normal resolution so an install that landed
// beside the scripts still works.
export async function loadPlayScraper() {
  const attempts = [path.join(WORK, 'package.json'), import.meta.filename];
  for (const from of attempts) {
    try {
      const resolved = createRequire(from).resolve('google-play-scraper');
      return (await import(pathToFileURL(resolved).href)).default;
    } catch { /* try next */ }
  }
  return null;
}
