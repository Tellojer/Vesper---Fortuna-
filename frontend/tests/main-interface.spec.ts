import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Sites come from the backend's missions.json (public/data/vesper)
  await expect(page.locator('.site-btn')).toHaveCount(22);
});

test('loads backend data and shows the current region', async ({ page }) => {
  await expect(page.locator('.region-name')).toHaveText('Nearside');
  await expect(page.locator('.region-meta')).toContainText('km/px mosaic');
  await expect(page.locator('.side-foot')).toContainText('Vesper data-pipeline');
  // Dates come from the backend ephemeris (2027)
  await expect(page.locator('.scrub-date .clock-date')).toContainText('01 Jan 2027');
  await expect(page.locator('canvas.scene-canvas')).toBeVisible();
  // Everything user-facing is in English
  await expect(page.locator('.sidebar')).not.toContainText(/pasada|candidata|Estados Unidos/);
});

test('region buttons switch to the stereographic polar maps', async ({ page }) => {
  await page.getByRole('button', { name: 'South Pole' }).last().click();
  await expect(page.locator('.region-name')).toHaveText('South Pole');
  await expect(page.locator('.region-meta')).toContainText('Stereographic');
  await page.keyboard.press('5');
  await expect(page.locator('.region-name')).toHaveText('North Pole');
  await expect(page.locator('.chip[aria-current="true"]')).toHaveAttribute('title', /Stereographic North/);
});

test('site panel shows terrain-aware Sun and Earth from the region data', async ({ page }) => {
  await page.locator('.site-btn', { hasText: 'Apollo 11' }).click();
  const panel = page.locator('.site-panel');
  await expect(panel.locator('.site-name')).toHaveText('Apollo 11');
  await expect(panel).toContainText('First crewed landing'); // translated note

  await panel.getByRole('tab', { name: 'Landing' }).click();
  await expect(panel.locator('.verdict-label')).toHaveText(/Suitable|Acceptable|Not recommended/);
  await expect(panel).toContainText('Sun visible');
  await expect(panel.locator('.aptitude-map canvas')).toBeVisible();

  await panel.getByRole('tab', { name: 'Sky' }).click();
  await expect(panel.locator('.dial svg')).toBeVisible();
  await expect(panel.locator('.readout-value').first()).toHaveText(/^[+−]\d+\.\d°$/);

  await panel.getByRole('tab', { name: 'Terrain' }).click();
  await expect(panel.locator('.relief img')).toBeVisible();
  await expect(panel).toContainText('Elevation at the best point');

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('search accepts site names and "lat, lon"', async ({ page }) => {
  const search = page.getByRole('combobox');
  await search.fill('-85.3, 31.2');
  await expect(page.getByRole('option').first()).toContainText('85.30° S, 31.20° E');
  await search.fill('shackleton rim');
  await expect(page.getByRole('option').first()).toContainText('Shackleton rim');
  await search.press('Enter');
  await expect(page.locator('.site-panel .site-name')).toHaveText('Shackleton rim');
});

test('timeline shows the date and moves through the backend hours', async ({ page }) => {
  const clock = page.locator('.scrub-date .clock-date');
  await expect(clock).toContainText('01 Jan 2027');
  await expect(clock).toContainText('00:00 UTC');
  await page.keyboard.press(']'); // +1 day
  await expect(clock).toContainText('02 Jan 2027');
  await page.keyboard.press(','); // -1 hour
  await expect(clock).toContainText('01 Jan 2027');
  await expect(clock).toContainText('23:00 UTC');
});

test('the navigator opens from its button and recommends generic sites per zone', async ({ page }) => {
  const reco = page.locator('.reco-panel');
  const toggle = page.getByRole('button', { name: 'Landing site navigator' });
  // Hidden until the button is pressed; pressing again hides it
  await expect(reco).toBeHidden();
  await toggle.click();
  await expect(reco).toBeVisible();
  await toggle.click();
  await expect(reco).toBeHidden();
  await toggle.click();
  await expect(reco.locator('.reco-title')).toContainText('Nearside');
  await expect(reco.locator('.reco-verdict').first()).toHaveText(/Suitable|Acceptable|Not recommended/);
  await page.keyboard.press('2'); // farside
  await expect(reco.locator('.reco-title')).toContainText('Farside');
  // Sites are independent of the missions: generic names, their own markers on the Moon
  // (2 areas around the Chang'e sites + 6 found by the backend survey of the whole zone)
  await expect(reco.locator('.reco-name')).toHaveCount(8);
  await expect(reco.locator('.reco-name').first()).toHaveText(/^Farside \d$/);
  await expect(page.locator('.marker[data-kind="reco"]')).toHaveCount(8);
  // Integer sliders drive the backend ranking
  const duration = reco.locator('.slider input').first();
  await duration.fill('3');
  await expect(reco.locator('.slider-head output').first()).toHaveText('3 days');
  // A recommended site opens with its generic name, not the mission's
  await reco.locator('.reco-item').first().click();
  await expect(page.locator('.site-panel .site-name')).toHaveText(/^Farside \d$/);
  await expect(page.locator('.site-panel')).toContainText('Recommended landing site');
});

test('mission markers can be hidden from the Moon', async ({ page }) => {
  await expect(page.locator('.marker[data-kind="historic"]').first()).toBeAttached();
  const sw = page.getByRole('switch', { name: 'Show on the Moon' });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.marker')).toHaveCount(0);
  // The list on the left stays
  await expect(page.locator('.site-btn')).toHaveCount(22);
  await sw.click();
  await expect(page.locator('.marker')).toHaveCount(22);
});

// Any coordinate is analysed by the live backend (/api/point); the answer is mocked here
const POINT = {
  lat: -85.3,
  lon: 31.2,
  alt_m: 1234.5,
  slope_deg: 4.2,
  dem: 'Polo Sur',
  dem_res_m: 87,
  year: { sun_pct: 60.4, earth_pct: 45.1, both_pct: 30.2 },
  window: {
    start: '2027-01-01T00:00',
    hours: 240,
    sun_pct: 20,
    earth_pct: 0,
    both_pct: 0,
    longest_sun_h: 30,
    score: 21.3,
    verdict: 'no recomendado',
    reasons: ['Poco Sol en la mision: 20% de las horas', 'Casi sin contacto directo con la Tierra: necesitaria satelite de relevo'],
    sun_countdown: { visible: false, hours: 12 },
    earth_countdown: { visible: false, hours: null },
    energy: { vertical_tracking_kwh_m2: 155.1, horizontal_kwh_m2: 0, best_panel: 'vertical' },
  },
};

test('custom coordinates are analysed by the backend', async ({ page }) => {
  let asked = '';
  await page.route('**/api/point?*', (route) => {
    asked = route.request().url();
    return route.fulfill({ json: POINT, headers: { 'access-control-allow-origin': '*' } });
  });
  const search = page.getByRole('combobox');
  await search.fill('-85.3, 31.2');
  await expect(page.getByRole('option').first()).toContainText('Analyse 85.30° S, 31.20° E');
  await search.press('Enter');

  const panel = page.locator('.point-panel');
  await expect(panel.locator('.site-name')).toHaveText('Custom site');
  await expect(panel.locator('.verdict-label')).toHaveText('Not recommended');
  await expect(panel.locator('.verdict-score')).toContainText('21 / 100');
  // Backend reasons are shown in English
  await expect(panel.locator('.reasons')).toContainText('it would need a relay satellite');
  await expect(panel).not.toContainText(/Poco Sol|necesitaria/);
  expect(asked).toContain('lat=-85.30000');
  expect(asked).toContain('date=2027-01-01T00%3A00');
  expect(asked).toContain('preset=equilibrada');
  await expect(page.locator('.marker[data-kind="custom"]')).toHaveAttribute('data-verdict', 'not-recommended');

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('clicking the Moon analyses that point; without the server the nearest precomputed point answers', async ({ page }) => {
  await page.route('**/api/point?*', (route) => route.abort());
  const canvas = page.locator('canvas.scene-canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const panel = page.locator('.point-panel');
  await expect(panel.locator('.site-name')).toHaveText('Custom site');
  // The answer comes from the global grid, and says so
  await expect(panel.locator('.site-detail')).toHaveText('Nearest precomputed point');
  await expect(panel.locator('.nearest-note')).toContainText(/\d+ km from the one you picked/);
  await expect(panel.locator('.verdict-label')).toHaveText(/Suitable|Acceptable|Not recommended/);
  await expect(panel.locator('.verdict-score')).toHaveText(/score \d+ \/ 100/);
  // The centre of the nearside always sees the Earth
  await expect(panel.locator('.stats-list div', { hasText: 'Earth visible' }).locator('dd')).toHaveText('100%');
  await expect(page.locator('.marker[data-kind="custom"]')).toHaveAttribute('data-verdict', /suitable|acceptable|not-recommended/);

  // The mission controls recompute it in the browser
  const before = await panel.locator('.verdict-score').textContent();
  // (with Earth always in view, weighting communication more raises the score)
  await panel.locator('.slider input').nth(1).fill('0');
  await expect(panel.locator('.slider-head output').nth(1)).toHaveText('Communication');
  await expect(panel.locator('.verdict-score')).not.toHaveText(before!);
});

test('an error answered by the server itself is shown, not replaced', async ({ page }) => {
  await page.route('**/api/point?*', (route) =>
    route.fulfill({ status: 400, json: { error: 'Fecha fuera de los datos' }, headers: { 'access-control-allow-origin': '*' } }),
  );
  const search = page.getByRole('combobox');
  await search.fill('10, 20');
  await search.press('Enter');
  await expect(page.locator('.point-panel').getByRole('alert')).toContainText('could not analyse this point');
});

test('voice assistant: asks for the region and takes you to the best site', async ({ page }) => {
  await page.getByRole('button', { name: 'Vesper', exact: true }).click();
  const voice = page.getByRole('dialog', { name: 'Voice assistant' });
  await expect(voice).toContainText('Which landing do you want to plan?');

  // Typed input follows the same path as speech
  const input = voice.getByRole('textbox', { name: 'Type your request' });
  await input.fill('Find the best landing site on March 12th at 2 pm');
  await input.press('Enter');
  await expect(voice).toContainText('Which region: nearside, farside, north pole or south pole?');
  await input.fill('the far side');
  await input.press('Enter');

  // The timeline, the view and the site panel follow; the answer quotes computed values
  await expect(page.locator('.scrub-date .clock-date')).toContainText('12 Mar 2027');
  await expect(page.locator('.scrub-date .clock-date')).toContainText('14:00 UTC');
  await expect(page.locator('.region-name')).toHaveText('Farside');
  await expect(page.locator('.site-panel .site-name')).toHaveText(/^Farside \d$/);
  await expect(voice).toContainText(/Farside \d is the best site in the Farside .* score \d+ out of 100/);

  // A year outside the data is refused instead of guessed
  await input.fill('best site on 2031-05-01 in the nearside');
  await input.press('Enter');
  await expect(voice).toContainText('My data covers 2027 only');
});

test('terrain tab shows where a rover can drive', async ({ page }) => {
  await page.locator('.site-btn', { hasText: 'IM-1' }).click();
  const panel = page.locator('.site-panel');
  await panel.getByRole('tab', { name: 'Terrain' }).click();
  const rover = panel.locator('.rover');
  await expect(rover).toContainText('Rover traversability');
  await expect(rover.locator('.slider-head output')).toHaveText('15° (VIPER)');
  const reach = rover.locator('.stats-list div').first().locator('dd');
  await expect(reach).toHaveText(/^\d+ km² \(\d+%\)$/);
  const km2 = async () => Number((await reach.textContent())!.split(' ')[0]);
  const viper = await km2();
  // A rover that climbs steeper ground reaches at least as much
  await rover.getByRole('button', { name: /Apollo LRV/ }).click();
  await expect(rover.locator('.slider-head output')).toHaveText('25° (Apollo LRV)');
  expect(await km2()).toBeGreaterThanOrEqual(viper);
  await expect(rover.getByRole('link', { name: /VIPER 15° \(NASA\)/ })).toHaveAttribute('href', /science\.nasa\.gov/);
});
