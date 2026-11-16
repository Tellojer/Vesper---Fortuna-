// Copies the Vesper backend outputs into the frontend, unchanged.
// Usage: npm run sync:backend   (run in frontend/; the pipeline is the repository root, one level up.
//        Set VESPER_BACKEND to use another checkout.)
//
//   ../web/data/*                  -> public/data/vesper/   (missions, regions, PNGs)
//   ../web/data-survey/*           -> public/data/vesper/survey/   (areas from design/tools/survey_zones.py +
//        grid_region.py; when that folder is absent, the survey already in public/ is kept)
//   ../data-pipeline/ephem_global.npz
//        -> public/data/vesper/ephem.bin + ephem.json
//
// ephem_global.npz (JPL Horizons, Moon-fixed frame, hourly) is only re-packed so a
// browser can read it: the same float64 values, stored as float32 in one binary.
// Frame (backend): x -> lon 0, y -> lon 90E, z -> north. Units: sun_u unit vector,
// earth_p kilometres.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const BACKEND = process.env.VESPER_BACKEND ?? path.resolve('..');
const SRC = path.join(BACKEND, 'web', 'data');
const OUT = path.resolve('public', 'data', 'vesper');

const SURVEY = path.join(BACKEND, 'web', 'data-survey');
const exists = (p) => fs.access(p).then(() => true, () => false);
if (!(await exists(SRC))) throw new Error(`No pipeline data at ${SRC}. Run this in frontend/ or set VESPER_BACKEND.`);

// Clear the previous copy; the survey is only replaced when the pipeline has a new one
const keepSurvey = !(await exists(SURVEY));
for (const f of await fs.readdir(OUT).catch(() => [])) {
  if (keepSurvey && f === 'survey') continue;
  if (f.startsWith('global-grid.')) continue; // written by design/tools/global_grid.py
  await fs.rm(path.join(OUT, f), { recursive: true, force: true });
}
await fs.mkdir(OUT, { recursive: true });

let copied = 0;
for (const f of await fs.readdir(SRC)) {
  await fs.copyFile(path.join(SRC, f), path.join(OUT, f));
  copied++;
}

if (!keepSurvey) {
  await fs.mkdir(path.join(OUT, 'survey'), { recursive: true });
  for (const f of await fs.readdir(SURVEY)) {
    await fs.copyFile(path.join(SURVEY, f), path.join(OUT, 'survey', f));
    copied++;
  }
}

// --- minimal .npz reader (zip of .npy files) ---
function unzip(buf) {
  const files = {};
  // End of central directory
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + csize);
    files[name] = method === 0 ? data : zlib.inflateRawSync(data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function npy(buf) {
  const headerLen = buf.readUInt16LE(8);
  const header = buf.toString('latin1', 10, 10 + headerLen);
  const descr = header.match(/'descr':\s*'([^']+)'/)[1];
  const shape = header.match(/'shape':\s*\(([^)]*)\)/)[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  const body = buf.subarray(10 + headerLen);
  return { descr, shape, body };
}

const npz = unzip(await fs.readFile(path.join(BACKEND, 'data-pipeline', 'ephem_global.npz')));
const sun = npy(npz['sun_u.npy']);
const earth = npy(npz['earth_p.npy']);
const times = npy(npz['times.npy']);
const step = npy(npz['step_h.npy']);
if (sun.descr !== '<f8' || earth.descr !== '<f8') throw new Error('Unexpected dtype in ephem_global.npz');

const n = sun.shape[0];
const f64 = (b) => new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
const s = f64(sun.body);
const e = f64(earth.body);
const out = new Float32Array(n * 6);
for (let t = 0; t < n; t++) {
  for (let k = 0; k < 3; k++) {
    out[t * 6 + k] = s[t * 3 + k];
    out[t * 6 + 3 + k] = e[t * 3 + k];
  }
}
// times: numpy '<U16' = 16 UTF-32LE code units per entry
const readTime = (i) => {
  let str = '';
  for (let c = 0; c < 16; c++) {
    const code = times.body.readUInt32LE((i * 16 + c) * 4);
    if (code) str += String.fromCodePoint(code);
  }
  return str;
};
const stepH = Number(step.body.readBigInt64LE(0));

await fs.writeFile(path.join(OUT, 'ephem.bin'), Buffer.from(out.buffer));
await fs.writeFile(
  path.join(OUT, 'ephem.json'),
  JSON.stringify(
    {
      source: 'ephem_global.npz (JPL Horizons, DE441), Vesper data-pipeline',
      frame: 'Moon-fixed: x -> lon 0, y -> lon 90E, z -> north',
      layout: 'float32 per hour: sun_u.x, sun_u.y, sun_u.z, earth_p.x, earth_p.y, earth_p.z (km)',
      start: readTime(0),
      end: readTime(n - 1),
      stepH,
      n,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ copied, n, start: readTime(0), end: readTime(n - 1), stepH }));
