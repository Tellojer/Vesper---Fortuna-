// Prepara las texturas lunares de NASA SVS (CGI Moon Kit, ID 4720) para la web.
// Uso: node design/tools/prepare-moon.mjs
//
// Entradas (data-raw/nasa-svs-4720/):
//   lroc_color_poles_4k.tif  color LROC WAC, 4096x2048, RGB 8 bit
//   ldem_16_uint.tif         LOLA, 5760x2880, uint16 en medios metros, +20000 de offset,
//                            relativo a una esfera de 1737.4 km
// Salidas (public/data/moon/):
//   color_4k.jpg             color
//   normal_4k.png            normales en espacio tangente (R = este, G = norte), con
//                            exageración vertical NORMAL_EXAGGERATION
//   height_4k.png            altura 8 bit, de minM a maxM (ver manifest)
//   manifest.json            fuentes, unidades y rangos
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const RAW = 'data-raw/nasa-svs-4720';
const OUT = 'public/data/moon';
const W = 4096, H = 2048;
const R_MOON = 1737400; // m
const NORMAL_EXAGGERATION = 4;

await fs.mkdir(OUT, { recursive: true });

// 1. Color
await sharp(path.join(RAW, 'lroc_color_poles_4k.tif'))
  .resize(W, H)
  .jpeg({ quality: 88, mozjpeg: true })
  .toFile(path.join(OUT, 'color_4k.jpg'));

// 2. Relieve
const dem = sharp(path.join(RAW, 'ldem_16_uint.tif'));
const meta = await dem.metadata();
const { data, info } = await dem.toColourspace('grey16').raw({ depth: 'ushort' }).toBuffer({ resolveWithObject: true });
const src = new Uint16Array(data.buffer, data.byteOffset, info.width * info.height * info.channels);
const sw = info.width, sh = info.height, ch = info.channels;

// Remuestreo bilineal a W x H, en metros relativos a 1737.4 km.
const h = new Float32Array(W * H);
let minM = Infinity, maxM = -Infinity;
for (let y = 0; y < H; y++) {
  const sy = ((y + 0.5) * sh) / H - 0.5;
  const y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(sh - 1, y0 + 1), fy = sy - Math.floor(sy);
  for (let x = 0; x < W; x++) {
    const sx = ((x + 0.5) * sw) / W - 0.5;
    const x0 = (Math.floor(sx) + sw) % sw, x1 = (x0 + 1) % sw, fx = sx - Math.floor(sx);
    const v = (xx, yy) => src[(yy * sw + xx) * ch] * 0.5 - 10000;
    const m = (v(x0, y0) * (1 - fx) + v(x1, y0) * fx) * (1 - fy) + (v(x0, y1) * (1 - fx) + v(x1, y1) * fx) * fy;
    h[y * W + x] = m;
    if (m < minM) minM = m;
    if (m > maxM) maxM = m;
  }
}

// Normales: pendiente este/norte en metros reales, exageradas.
const normal = Buffer.alloc(W * H * 3);
const height8 = Buffer.alloc(W * H);
const dyM = (Math.PI * R_MOON) / H;
for (let y = 0; y < H; y++) {
  const lat = (90 - ((y + 0.5) * 180) / H) * (Math.PI / 180);
  const dxM = Math.max(0.02, Math.cos(lat)) * ((2 * Math.PI * R_MOON) / W);
  for (let x = 0; x < W; x++) {
    const e = h[y * W + ((x + 1) % W)], w = h[y * W + ((x - 1 + W) % W)];
    const n = h[Math.max(0, y - 1) * W + x], s = h[Math.min(H - 1, y + 1) * W + x];
    const dEast = ((e - w) / (2 * dxM)) * NORMAL_EXAGGERATION;
    const dNorth = ((n - s) / (2 * dyM)) * NORMAL_EXAGGERATION;
    const len = Math.hypot(dEast, dNorth, 1);
    const k = (y * W + x) * 3;
    normal[k] = Math.round(((-dEast / len) * 0.5 + 0.5) * 255);
    normal[k + 1] = Math.round(((-dNorth / len) * 0.5 + 0.5) * 255);
    normal[k + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
    height8[y * W + x] = Math.round(((h[y * W + x] - minM) / (maxM - minM)) * 255);
  }
}
await sharp(normal, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'normal_4k.png'));
await sharp(height8, { raw: { width: W, height: H, channels: 1 } }).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'height_4k.png'));

// 3. Earth (background body): NASA SVS 3615, Blue Marble Next Generation based, with clouds
const EARTH_RAW = 'data-raw/nasa-svs-3615/flat_earth03.jpg';
const EARTH_OUT = 'public/data/earth';
await fs.mkdir(EARTH_OUT, { recursive: true });
const earthMeta = await sharp(EARTH_RAW).metadata();
await sharp(EARTH_RAW).jpeg({ quality: 88, mozjpeg: true }).toFile(path.join(EARTH_OUT, 'color_2k.jpg'));

const manifest = {
  body: 'moon',
  projection: 'equirectangular, centred on 0° longitude, north up',
  reference: 'sphere, radius 1737.4 km (MOON_ME)',
  color: { url: '/data/moon/color_4k.jpg', width: W, height: H },
  normal: { url: '/data/moon/normal_4k.png', width: W, height: H, exaggeration: NORMAL_EXAGGERATION },
  height: { url: '/data/moon/height_4k.png', width: W, height: H, minM: Math.round(minM), maxM: Math.round(maxM), units: 'm' },
  earth: {
    color: { url: '/data/earth/color_2k.jpg', width: earthMeta.width, height: earthMeta.height },
    projection: 'equirectangular, centred on 0° longitude, north up',
  },
  sources: [
    { name: 'LROC WAC color mosaic (2019)', via: 'NASA SVS CGI Moon Kit, ID 4720', file: 'lroc_color_poles_4k.tif', url: 'https://svs.gsfc.nasa.gov/4720/', credit: 'NASA / GSFC / Arizona State University' },
    { name: 'LOLA gridded elevation, 16 ppd', via: 'NASA SVS CGI Moon Kit, ID 4720', file: 'ldem_16_uint.tif', url: 'https://svs.gsfc.nasa.gov/4720/', credit: 'NASA / GSFC LOLA team', srcSize: `${meta.width}x${meta.height}` },
    { name: 'Earth texture, Blue Marble Next Generation based', via: 'NASA SVS, ID 3615', file: 'flat_earth03.jpg', url: 'https://svs.gsfc.nasa.gov/3615/', credit: 'NASA/Goddard Space Flight Center Scientific Visualization Studio; Blue Marble Next Generation courtesy of Reto Stockli (NASA/GSFC)' },
  ],
};
await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ minM: Math.round(minM), maxM: Math.round(maxM), src: `${sw}x${sh}x${ch}` }));
