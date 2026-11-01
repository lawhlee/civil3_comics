const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const expectedImages = JSON.parse(readFileSync('asset-packs/manifest.json', 'utf8')).files.filter(f => f.path.endsWith('.webp'));

async function catalog(page) {
  // Read the catalog actually served to this browser, including on the live site.
  return page.evaluate(() => window.COMIC_DATA);
}
async function imageReady(page, source) {
  const image = page.locator('#comicImage');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(im => ({
    path: new URL(im.currentSrc || im.src).pathname,
    width: im.naturalWidth,
    height: im.naturalHeight,
    complete: im.complete,
    visible: getComputedStyle(im).visibility,
  }))).toEqual({
    path: new URL(source.src, page.url()).pathname,
    width: source.width,
    height: source.height,
    complete: true,
    visible: 'visible',
  });
  await expect(page.locator('#imageLoading')).toBeHidden();
  await expect(page.locator('#imageError')).toBeHidden();
}
async function open(page, episode) {
  await page.goto(`./#read/${episode.id}`);
  await expect(page.locator('#readerTitle')).toHaveText(episode.title);
  const quality = await page.locator('#qualitySelect').inputValue();
  await imageReady(page, episode.sources[quality]);
}
async function screenshot(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, scale: 'css' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

// Normal user flows must not silently tolerate broken same-origin resources or JS.
test.beforeEach(async ({ page, request }) => {
  if (process.env.EXPECTED_DEPLOY_SHA) {
    await expect.poll(async () => {
      const response = await request.get(`build-info.json?sha=${process.env.EXPECTED_DEPLOY_SHA}`);
      return response.ok() ? (await response.json()).commit : null;
    }, { timeout: 90_000, message: 'The tested Pages version must match the deployed commit' })
      .toBe(process.env.EXPECTED_DEPLOY_SHA);
  }
  page.testErrors = [];
  page.expectedImageFailures = [];
  page.on('pageerror', error => page.testErrors.push(error.message));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === new URL(page.url()).origin && response.status() >= 400) {
      page.testErrors.push(`${response.status()} ${url.pathname}`);
    }
  });
});
test.afterEach(async ({ page }, testInfo) => {
  expect(page.testErrors.filter(error => !page.expectedImageFailures.includes(error))).toEqual([]);
});

test('library thumbnails, Korean/case search, filters and empty state', async ({ page }, testInfo) => {
  await page.goto('./');
  const data = await catalog(page);
  expect(data.episodes).toHaveLength(271);
  await expect(page.locator('.episode-card')).toHaveCount(271);
  const firstThumb = page.locator('.hero-cover img');
  await expect.poll(() => firstThumb.evaluate(im => im.complete && im.naturalWidth > 0)).toBe(true);
  const cardThumb = page.locator('.episode-card img').first();
  await cardThumb.scrollIntoViewIfNeeded();
  await expect.poll(() => cardThumb.evaluate(im => im.complete && im.naturalWidth > 0)).toBe(true);
  await noOverflow(page);
  const input = page.locator('#searchInput');
  for (const query of [data.episodes[0].title, '91다27228', '91다 27228']) {
    await input.fill(query);
    await expect(page.locator('.episode-card')).toHaveCount(1);
    await expect(page.locator('.card-link')).toHaveAttribute('href', '#read/L06_001');
  }
  await input.fill('이검색어는존재하지않습니다');
  await expect(page.locator('#emptyState')).toBeVisible();
  await expect(page.locator('.episode-card')).toHaveCount(0);
  await page.locator('#resetFilters').click();
  for (const chapter of data.chapters) {
    await page.locator(`#chapterTabs [data-lecture="${chapter.number}"]`).click();
    await expect(page.locator('.episode-card')).toHaveCount(chapter.count);
  }
  await screenshot(page, testInfo, 'library-chapter-10');
  await page.locator('.card-link').first().click();
  await imageReady(page, data.episodes.find(e => e.lecture === 10).sources.standard);
});

test('quality switches load exact dimensions and persist after reload', async ({ page }, testInfo) => {
  await page.goto('./');
  const { episodes } = await catalog(page);
  // Include a corrected image in the last lecture, not just the front cover.
  const episode = episodes.find(e => e.lecture === 10 && /_c/.test(e.image)) || episodes.at(-1);
  await open(page, episode);
  for (const quality of ['low', 'high', 'standard', 'high']) {
    await page.locator('#qualitySelect').selectOption(quality);
    await imageReady(page, episode.sources[quality]);
    await expect(page.locator('#qualitySize')).toContainText(`${episode.sources[quality].width}px`);
    await noOverflow(page);
  }
  await page.reload();
  await expect(page.locator('#qualitySelect')).toHaveValue('high');
  await imageReady(page, episode.sources.high);
  await screenshot(page, testInfo, 'corrected-high-quality');
  await page.locator('#zoom').click();
  await expect(page.locator('#comicStage')).toHaveClass(/zoomed/);
  expect(await page.locator('#comicImage').evaluate(im => im.getBoundingClientRect().width)).toBe(1536);
  await imageReady(page, episode.sources.high);
  await page.locator('#zoom').click();
  await noOverflow(page);
});

test('previous/next, lecture boundaries, TOC search and browser history', async ({ page }) => {
  await page.goto('./');
  const { episodes } = await catalog(page);
  await open(page, episodes[0]);
  await expect(page.locator('#previous')).toBeDisabled();
  await page.locator('#next').click();
  await imageReady(page, episodes[1].sources.standard);
  await expect(page).toHaveURL(/#read\/L06_002$/);
  await page.locator('#previous').click();
  await imageReady(page, episodes[0].sources.standard);
  await page.goBack();
  await expect(page).toHaveURL(/#read\/L06_002$/);
  await imageReady(page, episodes[1].sources.standard);
  await page.goForward();
  await imageReady(page, episodes[0].sources.standard);
  for (const lecture of [6, 7, 8, 9]) {
    const index = episodes.findLastIndex(e => e.lecture === lecture);
    await open(page, episodes[index]);
    await page.locator('#next').click();
    await expect(page.locator('#readerTitle')).toHaveText(episodes[index + 1].title);
    await imageReady(page, episodes[index + 1].sources.standard);
  }
  await page.locator('#openToc').click();
  await page.locator('#tocChapters [data-lecture="10"]').click();
  await page.locator('#tocSearch').fill(episodes.at(-1).title);
  await expect(page.locator('.toc-entry')).toHaveCount(1);
  await page.locator('.toc-entry').click();
  await expect(page.locator('#tocDialog')).not.toBeVisible();
  await imageReady(page, episodes.at(-1).sources.standard);
  await expect(page.locator('#next')).toBeDisabled();
});

test('rapid quality changes and navigation show the final selection', async ({ page }) => {
  await page.goto('./');
  const { episodes } = await catalog(page);
  await open(page, episodes[0]);
  for (const quality of ['low', 'high', 'standard', 'low']) {
    await page.locator('#qualitySelect').selectOption(quality);
  }
  await page.locator('#next').click();
  await expect(page).toHaveURL(/#read\/L06_002$/);
  await imageReady(page, episodes[1].sources.low);
  await page.locator('#backLibrary').click();
  await expect(page.locator('#library')).toBeVisible();
  await page.locator('#searchInput').fill(episodes[2].title);
  await page.locator('.card-link').click();
  await imageReady(page, episodes[2].sources.low);
});

test('a delayed obsolete image cannot replace the latest quality or episode', async ({ page }) => {
  await page.goto('./');
  const { episodes } = await catalog(page);
  await open(page, episodes[0]);
  const oldPath = new URL(episodes[0].sources.low.src, page.url()).pathname;
  let release, requested;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { requested = resolve; });
  await page.route(url => url.pathname === oldPath, async route => {
    requested();
    await gate;
    await route.continue().catch(() => {}); // The browser may cancel an obsolete request.
  });
  try {
    await page.locator('#qualitySelect').selectOption('low');
    await started;
    await page.locator('#qualitySelect').selectOption('high');
    await page.locator('#next').click();
    await imageReady(page, episodes[1].sources.high);
  } finally { release(); }
  await page.unrouteAll({ behavior: 'wait' });
  await imageReady(page, episodes[1].sources.high);
  await expect(page.locator('#readerTitle')).toHaveText(episodes[1].title);
});

test('keyboard or mobile swipes navigate; narrow portrait and landscape fit', async ({ page }, testInfo) => {
  await page.goto('./');
  const { episodes } = await catalog(page);
  await open(page, episodes[0]);
  if (testInfo.project.name.startsWith('mobile')) {
    await page.evaluate(() => {
      const stage = document.getElementById('comicStage');
      // WebKit does not expose a constructible Touch. Exercise the handler with
      // browser events carrying the same coordinates as a one-finger swipe.
      const touch = x => ({ identifier: 1, target: stage, clientX: x, clientY: 350 });
      const start = new Event('touchstart', { bubbles: true });
      Object.defineProperty(start, 'touches', { value: [touch(300)] });
      stage.dispatchEvent(start);
      const end = new Event('touchend', { bubbles: true });
      Object.defineProperties(end, {
        touches: { value: [] }, changedTouches: { value: [touch(100)] },
      });
      stage.dispatchEvent(end);
    });
  } else {
    await page.locator('#readerTitle').click();
    await page.keyboard.press('ArrowRight');
  }
  await imageReady(page, episodes[1].sources.standard);
  await expect(page).toHaveURL(/#read\/L06_002$/);
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await noOverflow(page);
    await expect(page.locator('#qualitySelect')).toBeVisible();
    await page.locator('#qualitySelect').selectOption('high');
    await imageReady(page, episodes[1].sources.high);
    await noOverflow(page);
  }
  await screenshot(page, testInfo, 'landscape-reader');
});

test('failed image displays retry UI and successfully recovers @fault', async ({ page }) => {
  await page.goto('./');
  const { episodes } = await catalog(page);
  const source = episodes[0].sources.standard;
  const pathname = new URL(source.src, page.url()).pathname;
  page.expectedImageFailures.push(`404 ${pathname}`);
  let attempts = 0;
  const block = route => { attempts++; return route.fulfill({ status: 404, body: 'Test image unavailable' }); };
  const matches = url => url.pathname === pathname;
  await page.route(matches, block);
  await page.locator('.hero-cover').click();
  await expect(page.locator('#imageError')).toBeVisible();
  await expect(page.locator('#imageLoading')).toBeHidden();
  expect(attempts).toBe(3); // Initial request plus two bounded automatic attempts.
  await page.unroute(matches, block);
  await page.locator('#retryImage').click();
  await imageReady(page, source);
  expect(await page.locator('#comicImage').getAttribute('src')).toContain('?retry=');
});

test('transient 503 errors recover automatically for reader and thumbnails @fault', async ({ page, baseURL }) => {
  const heroPath = new URL('assets/L06_001_thumb.webp', baseURL).pathname;
  page.expectedImageFailures.push(`503 ${heroPath}`);
  let coverAttempts = 0, releaseScript;
  const failedCover = new Promise(resolve => { releaseScript = resolve; });
  await page.route(url => url.pathname === heroPath, async route => {
    coverAttempts++;
    if (coverAttempts === 1) {
      await route.fulfill({ status: 503, body: 'Cover failed before app startup' });
      releaseScript();
    } else await route.continue();
  });
  await page.route(url => url.pathname.endsWith('/app.js'), async route => {
    await failedCover;
    await route.continue();
  });
  await page.goto('./');
  await expect.poll(() => page.locator('.hero-cover img').evaluate(im => im.complete && im.naturalWidth > 0)).toBe(true);
  expect(coverAttempts).toBeGreaterThanOrEqual(2);
  const { episodes } = await catalog(page);
  const readerPath = new URL(episodes[0].sources.standard.src, page.url()).pathname;
  let readerAttempts = 0;
  page.expectedImageFailures.push(`503 ${readerPath}`);
  await page.route(url => url.pathname === readerPath, route => {
    readerAttempts++;
    return readerAttempts === 1 ? route.fulfill({ status: 503, body: 'Temporary CDN failure' }) : route.continue();
  });
  await page.locator('.hero-cover').click();
  await imageReady(page, episodes[0].sources.standard);
  expect(readerAttempts).toBe(2);
  await page.locator('#backLibrary').click();
  const thumbnailPath = new URL(episodes.at(-1).thumbnail, page.url()).pathname;
  let thumbnailAttempts = 0;
  page.expectedImageFailures.push(`503 ${thumbnailPath}`);
  await page.route(url => url.pathname === thumbnailPath, route => {
    thumbnailAttempts++;
    return thumbnailAttempts === 1 ? route.fulfill({ status: 503, body: 'Temporary CDN failure' }) : route.continue();
  });
  await page.locator('#searchInput').fill(episodes.at(-1).title);
  const thumbnail = page.locator('.episode-card img');
  await thumbnail.scrollIntoViewIfNeeded();
  await expect.poll(() => thumbnail.evaluate(im => im.complete && im.naturalWidth > 0)).toBe(true);
  expect(thumbnailAttempts).toBe(2);
});

test('pending retries cannot overwrite a new quality or episode @fault', async ({ page }) => {
  await page.goto('./');
  const { episodes } = await catalog(page);
  const pathname = new URL(episodes[0].sources.standard.src, page.url()).pathname;
  page.expectedImageFailures.push(`503 ${pathname}`);
  await page.route(url => url.pathname === pathname, route => route.fulfill({ status: 503, body: 'Temporary failure' }));
  await page.locator('.hero-cover').click();
  await expect(page.locator('#imageLoading')).toContainText('다시 시도');
  await page.locator('#qualitySelect').selectOption('high');
  await page.locator('#next').click();
  await imageReady(page, episodes[1].sources.high);
  // Let any obsolete backoff expire before checking the final visible image.
  await page.waitForTimeout(1500);
  await imageReady(page, episodes[1].sources.high);
  await expect(page.locator('#readerTitle')).toHaveText(episodes[1].title);
});

test('all 1084 images match their original hashes and decode in the browser @all-assets', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium' && testInfo.project.name !== 'mobile-webkit', 'Once per browser engine');
  test.setTimeout(300_000);
  await page.goto('./');
  const result = await page.evaluate(async records => {
    const expected = new Map(records.map(f => [f.path, f]));
    const files = new Map();
    for (const e of window.COMIC_DATA.episodes) {
      files.set(e.thumbnail, { src: e.thumbnail });
      for (const source of Object.values(e.sources)) files.set(source.src, source);
    }
    const failures = [], recovered = [];
    if (files.size !== 1084 || expected.size !== 1084) return { failures: ['Expected 1084 unique images'], recovered };
    const queue = [...files.values()];
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (queue.length) {
        const source = queue.shift(), record = expected.get(source.src), retries = [];
        let objectUrl, decodeTimer;
        try {
          if (!record) throw new Error('Not in the original image manifest');
          let response;
          for (let attempt = 1; attempt <= 3; attempt++) {
            const url = new URL(source.src, location.href);
            if (attempt > 1) url.searchParams.set('asset-retry', `${Date.now()}-${attempt}`);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 30_000);
            try { response = await fetch(url, { signal: controller.signal, cache: 'no-store' }); }
            catch (error) {
              if (attempt === 3) throw error;
              retries.push({ src: source.src, status: 'network', attempt });
              await new Promise(resolve => setTimeout(resolve, attempt * 250));
              continue;
            } finally { clearTimeout(timer); }
            if (response.ok) break;
            if ((response.status >= 500 || [408, 429].includes(response.status)) && attempt < 3) {
              retries.push({ src: source.src, status: response.status, attempt });
              await new Promise(resolve => setTimeout(resolve, attempt * 250));
              continue;
            }
            throw new Error(`HTTP ${response.status}`);
          }
          const bytes = await response.arrayBuffer();
          const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
          if (bytes.byteLength !== record.bytes || digest !== record.sha256) throw new Error('Original size/SHA-256 mismatch');
          const image = new Image();
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }));
          image.src = objectUrl;
          await Promise.race([
            image.decode(),
            new Promise((_, reject) => { decodeTimer = setTimeout(() => reject(new Error('decode timeout')), 30_000); }),
          ]);
          if (!image.naturalWidth || !image.naturalHeight || (source.width && (image.naturalWidth !== source.width || image.naturalHeight !== source.height))) {
            throw new Error(`${image.naturalWidth}x${image.naturalHeight}`);
          }
          recovered.push(...retries);
        } catch (error) { failures.push(`${source.src}: ${error.message}`); }
        finally { clearTimeout(decodeTimer); if (objectUrl) URL.revokeObjectURL(objectUrl); }
      }
    }));
    return { failures, recovered };
  }, expectedImages);
  // Account only for specific failed attempts that later passed hash and decode checks.
  // Permanent errors and unrelated browser/resource errors still fail the run.
  for (const retry of result.recovered) {
    const error = `${retry.status} ${new URL(retry.src, page.url()).pathname}`;
    const index = page.testErrors.indexOf(error);
    if (index >= 0) page.testErrors.splice(index, 1);
  }
  await testInfo.attach('image-integrity-and-recoveries', {
    body: JSON.stringify({ images: expectedImages.length, ...result }, null, 2), contentType: 'application/json',
  });
  expect(result.failures).toEqual([]);
});
