// Extracts the flare of the original logo without its painted trails.
// Usage: node design/tools/extract-flare.cjs design/brand/vesper_logo_4320.png public/brand/vesper_flare.png <debug.png>
// In the diagonal sectors (where the trails are) each pixel is replaced by the
// darkest of its 8 symmetric counterparts (the star and its halo have 4-axis
// symmetry; the trails do not). On the axes the original is kept untouched.
// Then: centred crop, black background -> transparency (alpha = brightness).
const fs = require('fs');
const { chromium } = require('@playwright/test');

const [input, output, debug] = process.argv.slice(2);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const src = 'data:image/png;base64,' + fs.readFileSync(input).toString('base64');
  const result = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const W = img.width, H = img.height;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data;
    const lum = (i) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;

    // Exact centre: brightness centroid of the spikes.
    let sx = 0, sw = 0, sy = 0, sh = 0;
    for (let x = 0; x < W; x++) { const l = lum((Math.round(H * 0.3) * W + x) * 4); if (l > 200) { sx += x * l; sw += l; } }
    for (let y = 0; y < H; y++) { const l = lum((y * W + Math.round(W * 0.3)) * 4); if (l > 200) { sy += y * l; sh += l; } }
    const cx = Math.round(sx / sw), cy = Math.round(sy / sh);

    // Crop: tips of the star at 90% of the radius.
    let tip = 0;
    for (let y = 0; y < cy; y++) { if (lum((y * W + cx) * 4) > 180) { tip = cy - y; break; } }
    const half = Math.round(tip / 0.9);
    const OUT = 512, S = (2 * half) / OUT;

    const o = document.createElement('canvas');
    o.width = OUT; o.height = OUT;
    const octx = o.getContext('2d');
    const od = octx.createImageData(OUT, OUT);

    const sample = (x, y) => {
      const xi = Math.min(W - 1, Math.max(0, Math.round(x))), yi = Math.min(H - 1, Math.max(0, Math.round(y)));
      return (yi * W + xi) * 4;
    };
    const smooth = (e0, e1, v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

    // Halo profile by radius: the darkest pixel of each ring inside the
    // diagonal sectors (the trails only occupy some angles).
    const NR = Math.ceil(half * Math.SQRT2) + 2;
    const prof = new Array(NR).fill(null);
    for (let rad = 0; rad < NR; rad++) {
      let bestK = -1, bestL = Infinity;
      for (let t = 0; t < 360; t += 0.5) {
        const ang = t % 90, fromAxis = Math.min(ang, 90 - ang);
        if (fromAxis < 16) continue;
        const a = t * Math.PI / 180;
        const k = sample(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
        const l = lum(k);
        if (l < bestL) { bestL = l; bestK = k; }
      }
      prof[rad] = [d[bestK], d[bestK + 1], d[bestK + 2]];
    }
    // Smooth the radial profile so no disc edge is left.
    const SM = 70;
    const raw = prof.map((p) => p.slice());
    for (let rad = 0; rad < NR; rad++) {
      const acc = [0, 0, 0]; let wsum = 0;
      for (let q = Math.max(0, rad - SM * 2); q < Math.min(NR, rad + SM * 2); q++) {
        const wq = Math.exp(-((q - rad) ** 2) / (2 * SM * SM));
        for (let c = 0; c < 3; c++) acc[c] += raw[q][c] * wq;
        wsum += wq;
      }
      prof[rad] = acc.map((v) => v / wsum);
    }
    const profileAt = (rad) => {
      const r0 = Math.min(NR - 2, Math.floor(rad)), f = rad - r0;
      return [0, 1, 2].map((c) => prof[r0][c] * (1 - f) + prof[r0 + 1][c] * f);
    };

    for (let j = 0; j < OUT; j++) {
      for (let i = 0; i < OUT; i++) {
        const dx = (i + 0.5) * S - half, dy = (j + 0.5) * S - half;
        const orig = sample(cx + dx, cy + dy);
        // Angle to the nearest axis (0° on the axes, 45° on the diagonals).
        const ang = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI;
        const fromAxis = Math.min(ang, 90 - ang);
        // Keep: the angular band of the axes + the wide base of the spikes
        // next to the centre (perpendicular distance to the nearest axis).
        const rad = Math.hypot(dx, dy);
        const perp = Math.min(Math.abs(dx), Math.abs(dy));
        const baseW = 40 * (1 - smooth(0, 420, rad));
        const keep = Math.max(1 - smooth(5, 14, fromAxis), baseW > 1 ? 1 - smooth(baseW * 0.6, baseW * 1.4, perp) : 0);
        const w = 1 - keep; // 0 = keep the original, 1 = clean halo
        const halo = profileAt(Math.hypot(dx, dy));
        // Never brighter than the original (the axes keep their detail).
        const base = [d[orig], d[orig + 1], d[orig + 2]];
        const clean = halo.map((v, c) => Math.min(v, base[c]));
        let r = base[0] + (clean[0] - base[0]) * w;
        let g = base[1] + (clean[1] - base[1]) * w;
        let b = base[2] + (clean[2] - base[2]) * w;
        // Black -> transparent: alpha = brightest channel, colour not premultiplied.
        let a = Math.max(r, g, b);
        // Fade the edge of the crop so the square does not show.
        const rr = Math.hypot(dx, dy) / half;
        a *= 1 - smooth(0.82, 1.0, rr);
        const k = (j * OUT + i) * 4;
        if (a > 0.5) { od.data[k] = Math.min(255, r * 255 / Math.max(r, g, b)); od.data[k + 1] = Math.min(255, g * 255 / Math.max(r, g, b)); od.data[k + 2] = Math.min(255, b * 255 / Math.max(r, g, b)); }
        od.data[k + 3] = a;
      }
    }
    octx.putImageData(od, 0, 0);

    // Debug: cropped original | cleaned, on black.
    const dbg = document.createElement('canvas');
    dbg.width = OUT * 2; dbg.height = OUT;
    const dctx = dbg.getContext('2d');
    dctx.fillStyle = '#000'; dctx.fillRect(0, 0, OUT * 2, OUT);
    dctx.drawImage(img, cx - half, cy - half, 2 * half, 2 * half, 0, 0, OUT, OUT);
    dctx.drawImage(o, OUT, 0);
    return { cx, cy, tip, half, out: o.toDataURL('image/png'), dbg: dbg.toDataURL('image/png') };
  }, src);
  fs.writeFileSync(output, Buffer.from(result.out.split(',')[1], 'base64'));
  fs.writeFileSync(debug, Buffer.from(result.dbg.split(',')[1], 'base64'));
  console.log(JSON.stringify({ cx: result.cx, cy: result.cy, tip: result.tip, half: result.half }));
  await browser.close();
})();
