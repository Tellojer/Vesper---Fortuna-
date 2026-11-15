import { test, expect, type Page } from '@playwright/test';

const rotateOf = (page: Page, part: string) =>
  page.locator(`[data-part="${part}"]`).evaluate((el) => getComputedStyle(el).rotate);

test('la burbuja de Vesper está abajo al centro y es accesible', async ({ page }) => {
  await page.goto('/');
  const bubble = page.getByRole('button', { name: 'Vesper' });
  await expect(bubble).toBeVisible();

  const box = (await bubble.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - vp.width / 2)).toBeLessThan(2);
  expect(vp.height - (box.y + box.height)).toBeGreaterThan(8);
  expect(vp.height - (box.y + box.height)).toBeLessThan(60);

  // Reachable by keyboard: tab through the interface until the bubble has focus
  for (let i = 0; i < 150 &&!(await bubble.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(bubble).toBeFocused();
});

test('las estelas recorren su órbita y vuelven; el destello no gira', async ({ page }) => {
  await page.goto('/');
  const bubble = page.getByRole('button', { name: 'Vesper' });
  const comet = page.locator('[data-comet]').first();
  const offsetOf = () => comet.evaluate((el) => parseFloat(getComputedStyle(el).strokeDashoffset));
  // Espera a que la Luna termine de cargar: mientras se decodifican las texturas 4K el hilo
  // principal se congela y la órbita (1.5 s) puede empezar y acabar sin que se vea un fotograma
  await expect(page.locator('.side-foot')).toBeVisible();
  await expect(page.locator('.loading-text')).toHaveCount(0);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const rest = await offsetOf();
  await bubble.click();
  // en movimiento por la elipse
  await expect.poll(async () => Math.abs((await offsetOf()) - rest), { timeout: 3000, intervals: [100] }).toBeGreaterThan(5);
  expect(['none', '0deg']).toContain(await rotateOf(page, 'star'));

  await bubble.click(); // un segundo clic no reinicia la órbita en curso

  await expect.poll(() => page.evaluate(() => document.getAnimations().length), { timeout: 5000 }).toBe(0);
  expect(await offsetOf()).toBeCloseTo(rest, 3); // de vuelta a su posición
  expect(['none', '0deg']).toContain(await rotateOf(page, 'star'));
  expect(await page.locator('.vesper-ripple, .vesper-beam').count()).toBe(0);
});

test('con movimiento reducido solo hay destello, sin giro', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Vesper' }).click();
  await page.waitForTimeout(800);
  expect(['none', '0deg']).toContain(await rotateOf(page, 'star'));
});
