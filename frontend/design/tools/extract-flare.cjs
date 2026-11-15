// Extrae el destello del logo original sin las estelas pintadas.
// Uso: node design/tools/extract-flare.cjs design/brand/vesper_logo_4320.png public/brand/vesper_flare.png <debug.png>
// En los sectores diagonales (donde están las estelas) cada píxel se sustituye
// por el más oscuro de sus 8 simétricos (la estrella y su halo tienen simetría
// de 4 ejes; las estelas no). En los ejes se conserva el original intacto.
// Después: recorte centrado, fondo negro -> transparencia (alfa = brillo).
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

    // Centro exacto: centroide de brillo de las agujas.
    let sx = 0, sw = 0, sy = 0, sh = 0;
    for (let x = 0; x < W; x++) { const l = lum((Math.round(H * 0.3) * W + x) * 4); if (l > 200) { sx += x * l; sw += l; } }
    for (let y = 0; y < H; y++) { const l = lum((y * W + Math.round(W * 0.3)) * 4); if (l > 200) { sy += y * l; sh += l; } }
    const cx = Math.round(sx / sw), cy = Math.round(sy / sh);

    // Recorte: puntas de la estrella al 90% del radio.
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

    // Perfil del halo por radio: el píxel más oscuro de cada anillo dentro de
    // los sectores diagonales (las estelas solo ocupan algunos ángulos).
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
    // Suavizar el perfil por radio para que no quede un borde de disco.
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
        // Ángulo al eje más cercano (0° en los ejes, 45° en las diagonales).
        const ang = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI;
        const fromAxis = Math.min(ang, 90 - ang);
        // Conservar: banda angular de los ejes + la base ancha de las agujas
        // junto al centro (distancia perpendicular al eje más cercano).
        const rad = Math.hypot(dx, dy);
        const perp = Math.min(Math.abs(dx), Math.abs(dy));
        const baseW = 40 * (1 - smooth(0, 420, rad));
        const keep = Math.max(1 - smooth(5, 14, fromAxis), baseW > 1 ? 1 - smooth(baseW * 0.6, baseW * 1.4, perp) : 0);
        const w = 1 - keep; // 0 = conservar original, 1 = halo limpio
        const halo = profileAt(Math.hypot(dx, dy));
        // Nunca más brillante que el original (los ejes conservan su detalle).
        const base = [d[orig], d[orig + 1], d[orig + 2]];
        const clean = halo.map((v, c) => Math.min(v, base[c]));
        let r = base[0] + (clean[0] - base[0]) * w;
        let g = base[1] + (clean[1] - base[1]) * w;
        let b = base[2] + (clean[2] - base[2]) * w;
        // Negro -> transparente: alfa = canal más brillante, color sin premultiplicar.
        let a = Math.max(r, g, b);
        // Desvanecer el borde del recorte para que no se vea el cuadrado.
        const rr = Math.hypot(dx, dy) / half;
        a *= 1 - smooth(0.82, 1.0, rr);
        const k = (j * OUT + i) * 4;
        if (a > 0.5) { od.data[k] = Math.min(255, r * 255 / Math.max(r, g, b)); od.data[k + 1] = Math.min(255, g * 255 / Math.max(r, g, b)); od.data[k + 2] = Math.min(255, b * 255 / Math.max(r, g, b)); }
        od.data[k + 3] = a;
      }
    }
    octx.putImageData(od, 0, 0);

    // Debug: original recortado | limpio, sobre negro.
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
