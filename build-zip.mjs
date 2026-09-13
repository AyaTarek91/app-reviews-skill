// Builds dist/app-reviews.zip for upload to claude.ai or Cowork.
//
//   node build-zip.mjs
//
// Two things this has to get right, and both have bitten:
//
// 1. Those surfaces want the SKILL FOLDER as the zip's root, not the files loose
//    inside it — `app-reviews/SKILL.md`, never `SKILL.md` at the top.
// 2. Entry names must use FORWARD slashes. Windows PowerShell 5.1's
//    Compress-Archive writes `app-reviews\SKILL.md`, which is off-spec; a
//    Linux-side unzip then reads that as one file with a backslash in its name
//    and the folder disappears. So the archive is written here rather than
//    shelled out to any OS tool. No dependencies — node:zlib only.

import fs from 'node:fs/promises';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SKILL_NAME = 'app-reviews';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, 'plugins', SKILL_NAME, 'skills', SKILL_NAME);
const dist = path.join(here, 'dist');
const zipPath = path.join(dist, `${SKILL_NAME}.zip`);

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const dosStamp = (d) => ({
  time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31),
  date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
});

// Collect every file and folder under src, named relative to a SKILL_NAME root.
async function walk(dir, prefix, out) {
  for (const e of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, e.name);
    const name = `${prefix}${e.name}`;
    const { mtime } = await fs.stat(abs);
    if (e.isDirectory()) {
      out.push({ name: `${name}/`, dir: true, data: Buffer.alloc(0), mtime });
      await walk(abs, `${name}/`, out);
    } else if (e.isFile()) {
      out.push({ name, dir: false, data: await fs.readFile(abs), mtime });
    }
  }
  return out;
}

try {
  await fs.access(path.join(src, 'SKILL.md'));
} catch {
  console.error(`No SKILL.md under ${src} — run this from the repo root.`);
  process.exit(1);
}

const entries = await walk(src, `${SKILL_NAME}/`, [
  { name: `${SKILL_NAME}/`, dir: true, data: Buffer.alloc(0), mtime: new Date() },
]);

const locals = [];
const centrals = [];
let offset = 0;

for (const e of entries) {
  const nameBuf = Buffer.from(e.name, 'utf8');
  const { time, date } = dosStamp(e.mtime);
  const crc = e.dir ? 0 : crc32(e.data);
  const body = e.dir ? Buffer.alloc(0) : deflateRawSync(e.data, { level: 9 });
  const method = e.dir ? 0 : 8;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);          // version needed
  local.writeUInt16LE(0x0800, 6);      // flags: UTF-8 names
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(e.data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);          // extra field length
  locals.push(local, nameBuf, body);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x031e, 4);    // made by: unix, spec 3.0
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(e.data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);        // extra
  central.writeUInt16LE(0, 32);        // comment
  central.writeUInt16LE(0, 34);        // disk number
  central.writeUInt16LE(0, 36);        // internal attrs
  central.writeUInt32LE(e.dir ? 0x41ed0010 : 0x81a40000, 38); // unix mode + DOS dir bit
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBuf);

  offset += local.length + nameBuf.length + body.length;
}

const centralBuf = Buffer.concat(centrals);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(entries.length, 8);
eocd.writeUInt16LE(entries.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

await fs.mkdir(dist, { recursive: true });
await fs.writeFile(zipPath, Buffer.concat([...locals, centralBuf, eocd]));

const { size } = await fs.stat(zipPath);
const files = entries.filter((e) => !e.dir).length;
console.log(`\n  ${path.relative(here, zipPath)}  —  ${(size / 1024).toFixed(0)} KB, ${files} files`);
console.log(`  root entry: ${SKILL_NAME}/  (forward slashes)`);
console.log(`\n  Upload it at claude.ai or Cowork: Customize -> Skills -> upload.\n`);
