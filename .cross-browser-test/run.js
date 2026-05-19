#!/usr/bin/env node
/**
 * Mercer's cross-browser/device test harness.
 *
 * What it does, per device profile:
 *   1. Launches the matching browser engine (chromium/webkit/firefox).
 *   2. Sets the device viewport, DPR, user agent, touch flag.
 *   3. Throttles CPU + network to mobile-typical speeds.
 *   4. Loads the site cold (no cache).
 *   5. Captures: console errors, network errors, a screenshot of page 0,
 *      then sweeps every hero page and screenshots each in a state where
 *      the previous fade is fully done (this is the state a real user sees).
 *      That is the exact moment a half/half transition glitch would appear.
 *   6. Records hero load timings + which images finished before auto-rotate
 *      would have first fired.
 *   7. Writes a per-device summary into ./output/<device>/ and a single
 *      index.html with side-by-side thumbnails for visual diff.
 *
 * Usage:
 *   npm install
 *   npm run install-browsers
 *   npm test                              # all profiles
 *   npm test -- --only "iPhone 13"        # one profile (substring match)
 *   npm test -- --url https://staging...  # override URL
 */
import { chromium, webkit, firefox, devices } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output');
const args = process.argv.slice(2);
const argOnly = (() => {
    const i = args.indexOf('--only');
    return i >= 0 ? args[i + 1] : null;
})();
const URL_TO_TEST = (() => {
    const i = args.indexOf('--url');
    return i >= 0 ? args[i + 1] : 'https://mercersprecisionpainting.com/';
})();

/**
 * Profiles. Each entry picks an engine and a device descriptor.
 * Playwright bundles 100+ descriptors in `devices`; we name the ones that
 * map onto Mercer's actual customer demographics:
 *   - iPhone SE 2nd gen (DPR 2, old Safari quirks, common in NSW)
 *   - iPhone 13 (DPR 3, current-mainstream)
 *   - iPhone 13 Pro Max (closest available match for iPhone 15 Pro on this
 *     Playwright version; DPR 3, 428 CSS px wide, real WebKit)
 *   - Pixel 7 (Chrome on Android, mainstream)
 *   - Galaxy S9+ (Chrome on Android, large screen, DPR 4)
 *   - Galaxy S9+ Samsung Internet (chromium engine + Samsung Internet UA;
 *     not byte-perfect Samsung Internet but catches UA-sniffing + most
 *     paint differences since Samsung Internet IS a chromium fork)
 */
const PROFILES = [
    // Real WebKit (= real Safari engine). Skipped automatically if libicu74 isn't on
    // the host — run via docker (see README) for accurate iOS Safari testing.
    { name: 'iPhone SE',                 engine: 'webkit',   device: 'iPhone SE' },
    { name: 'iPhone 13',                 engine: 'webkit',   device: 'iPhone 13' },
    { name: 'iPhone 13 Pro Max',         engine: 'webkit',   device: 'iPhone 13 Pro Max' },
    // Chromium with iPhone viewport/UA. Doesn't catch WebKit-specific paint bugs but
    // does catch layout, sizing, touch, and JS bugs that come from the iOS form factor.
    { name: 'iPhone 13 (chromium UA)',   engine: 'chromium', device: 'iPhone 13' },
    // Android Chrome.
    { name: 'Pixel 7',                   engine: 'chromium', device: 'Pixel 7' },
    { name: 'Galaxy S9+',                engine: 'chromium', device: 'Galaxy S9+' },
    {
        name: 'Samsung Internet (Galaxy)',
        engine: 'chromium',
        device: 'Galaxy S9+',
        // Real Samsung Internet UA, 2025-current.
        userAgentOverride:
            'Mozilla/5.0 (Linux; Android 14; SM-G998U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/123.0.0.0 Mobile Safari/537.36',
    },
];

const ENGINES = { chromium, webkit, firefox };

const ROTATE_INTERVAL_MS = 4500; // matches autoRotate in initBookTurn
const HERO_FADE_MS = 350;        // matches DUR in goTo (fast crossfade)

async function run() {
    await fs.rm(OUT_DIR, { recursive: true, force: true });
    await fs.mkdir(OUT_DIR, { recursive: true });

    const results = [];
    for (const profile of PROFILES) {
        if (argOnly && !profile.name.toLowerCase().includes(argOnly.toLowerCase())) continue;
        console.log(`\n=== ${profile.name} (${profile.engine}) ===`);
        const slug = profile.name.toLowerCase().replace(/\W+/g, '-');
        const dir = path.join(OUT_DIR, slug);
        await fs.mkdir(dir, { recursive: true });
        try {
            const r = await testProfile(profile, dir);
            results.push({ ...r, profile, slug });
        } catch (err) {
            const msg = err.message || String(err);
            const isLibIcu = /libicudata|libflite|libxml2/.test(msg);
            const hint = isLibIcu
                ? '  HINT: this is a missing-system-lib problem (libicu74 etc). Run via docker (see README) for real WebKit.'
                : '';
            console.error(`  FAILED:`, msg.split('\n')[0]);
            if (hint) console.error(hint);
            results.push({ profile, slug, error: msg });
        }
    }

    await writeIndex(results);
    console.log(`\nDone. Open output/index.html in a browser.`);
}

async function testProfile(profile, dir) {
    const engine = ENGINES[profile.engine];
    const device = devices[profile.device];
    if (!device) throw new Error(`unknown device descriptor "${profile.device}"`);

    const browser = await engine.launch({ headless: true });
    const contextOpts = {
        ...device,
        bypassCSP: false,
        ignoreHTTPSErrors: false,
    };
    if (profile.userAgentOverride) contextOpts.userAgent = profile.userAgentOverride;
    const context = await browser.newContext(contextOpts);
    const page = await context.newPage();

    const consoleErrors = [];
    const networkErrors = [];
    page.on('console', m => {
        if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', r => networkErrors.push(`${r.url()} - ${r.failure()?.errorText}`));

    // Throttle to a realistic mobile network on chromium (only chromium has CDP throttle).
    if (profile.engine === 'chromium') {
        const client = await context.newCDPSession(page);
        await client.send('Network.emulateNetworkConditions', {
            offline: false,
            downloadThroughput: (4 * 1024 * 1024) / 8, // 4 Mbps
            uploadThroughput: (1 * 1024 * 1024) / 8,
            latency: 150,
        });
        await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }

    const navStart = Date.now();
    await page.goto(URL_TO_TEST, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('h1.hero-h1', { timeout: 30000 });
    const navDoneMs = Date.now() - navStart;

    // Wait for the preloader to clear so the hero is actually visible.
    await page.waitForFunction(() => {
        const pre = document.getElementById('preloader');
        return !pre || getComputedStyle(pre).opacity === '0' || pre.style.display === 'none';
    }, null, { timeout: 15000 }).catch(() => {}); // not fatal if site lacks preloader

    // First screenshot. Captures page 0 in its natural rendered state.
    await page.screenshot({ path: path.join(dir, '00-page-0.png'), type: 'png' });

    // Collect hero state and resource timings.
    const heroState = await page.evaluate(() => {
        const pages = Array.from(document.querySelectorAll('.book-page'));
        const result = pages.map((p, i) => {
            const img = p.querySelector('.pg-img');
            const cs = img ? getComputedStyle(img) : null;
            const bg = cs ? cs.backgroundImage : '';
            const match = bg.match(/url\(["']?([^"')]+)["']?\)/);
            return {
                id: p.id,
                idx: i,
                visible: getComputedStyle(p).display !== 'none',
                bgUrl: match ? match[1] : null,
                bgSize: cs ? cs.backgroundSize : null,
            };
        });
        const resources = performance.getEntriesByType('resource')
            .filter(e => e.name.match(/\.(webp|jpe?g|avif|png)$|images\.unsplash/i))
            .map(e => ({ url: e.name, end: Math.round(e.responseEnd), kb: Math.round((e.encodedBodySize || e.transferSize) / 1024) }));
        return { pages: result, resources, viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio } };
    });

    // Sweep every hero page (skip ones with display:none on this profile)
    // by clicking each dot in turn, waiting for the fade to complete, then
    // screenshotting. THIS is the exact frame a real user sees as "done"
    // and is where the half-half artifact would still be visible if it exists.
    const dots = await page.locator('.page-dot').all();
    const sweepResults = [];
    for (let i = 0; i < dots.length; i++) {
        const visible = await dots[i].isVisible().catch(() => false);
        if (!visible) continue;
        await dots[i].click().catch(() => {});
        await page.waitForTimeout(HERO_FADE_MS + 200);
        // Mid-transition shot: re-click immediately to capture overlap.
        // We take the post-transition shot first (clean state), then trigger
        // the next and capture mid-transition to look for half-half overlap.
        await page.screenshot({ path: path.join(dir, `page-${i}-done.png`), type: 'png' });
        const nextIdx = (i + 1) % dots.length;
        const nextVisible = await dots[nextIdx].isVisible().catch(() => false);
        if (nextVisible) {
            await dots[nextIdx].click().catch(() => {});
            await page.waitForTimeout(HERO_FADE_MS / 2);
            await page.screenshot({ path: path.join(dir, `page-${i}-to-${nextIdx}-mid.png`), type: 'png' });
            // Settle so the next iteration's screenshot is clean.
            await page.waitForTimeout(HERO_FADE_MS);
        }
        sweepResults.push({ idx: i });
    }

    // URL bar collapse simulation. Real phones change the visible viewport
    // when the address bar shrinks on scroll. Some Playwright device profiles
    // already account for this, but to be safe we resize the page taller by
    // 80px (typical address-bar height on Pixel/Galaxy in Chrome/Brave) and
    // re-screenshot every visible hero. Anything that gets exposed below the
    // hero (about section, gap, etc.) is a real-device layout bug.
    const originalSize = page.viewportSize();
    await page.setViewportSize({ width: originalSize.width, height: originalSize.height + 80 });
    await page.waitForTimeout(300);
    for (let i = 0; i < dots.length; i++) {
        const visible = await dots[i].isVisible().catch(() => false);
        if (!visible) continue;
        await dots[i].click().catch(() => {});
        await page.waitForTimeout(HERO_FADE_MS + 200);
        await page.screenshot({ path: path.join(dir, `tall-page-${i}.png`), type: 'png' });
    }

    // Also a full-page screenshot so we can see the hero -> strip -> about
    // boundary and verify the strip sits flush with no exposed gap.
    await page.setViewportSize(originalSize);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(dir, 'zz-full-page.png'), type: 'png', fullPage: true });

    // Final summary write
    const summary = {
        profile: profile.name,
        engine: profile.engine,
        viewport: heroState.viewport,
        navMs: navDoneMs,
        consoleErrors,
        networkErrors,
        heroPages: heroState.pages,
        resourcesBeforeFirstRotate: heroState.resources
            .filter(r => r.end < ROTATE_INTERVAL_MS)
            .sort((a, b) => b.kb - a.kb),
        sweep: sweepResults,
    };
    await fs.writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));

    await context.close();
    await browser.close();
    console.log(`  viewport=${heroState.viewport.w}x${heroState.viewport.h} dpr=${heroState.viewport.dpr}`);
    console.log(`  console errors: ${consoleErrors.length}`);
    console.log(`  network failures: ${networkErrors.length}`);
    return summary;
}

async function writeIndex(results) {
    // Pre-resolve all screenshot lists since template literals can't await.
    const withFiles = await Promise.all(results.map(async r => ({
        ...r,
        files: r.slug ? await listScreens(r.slug) : [],
    })));
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Mercer's cross-browser test</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 24px; background: #f5f5f5; }
  h1 { margin: 0 0 16px; }
  .device { background: #fff; border-radius: 6px; padding: 16px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .device h2 { margin: 0 0 8px; font-size: 18px; }
  .device .meta { color: #666; font-size: 13px; margin-bottom: 12px; }
  .err { color: #b00; font-weight: 600; }
  .ok { color: #060; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
  .grid figure { margin: 0; }
  .grid img { width: 100%; aspect-ratio: 9/16; object-fit: cover; border: 1px solid #ddd; border-radius: 4px; }
  .grid figcaption { font-size: 11px; color: #666; margin-top: 4px; word-break: break-all; }
  pre { background: #f0f0f0; padding: 8px; overflow-x: auto; font-size: 12px; }
</style>
</head><body>
<h1>Mercer's Precision Painting — cross-browser test results</h1>
<p>URL tested: <a href="${URL_TO_TEST}">${URL_TO_TEST}</a> · ${new Date().toISOString()}</p>
${withFiles.map(r => {
    if (r.error) return `<div class="device"><h2>${r.profile.name}</h2><p class="err">${r.error}</p></div>`;
    const thumbs = r.files.map(f =>
      `<figure><img src="${r.slug}/${f}" loading="lazy"><figcaption>${f.replace('.png','')}</figcaption></figure>`
    ).join('');
    return `<div class="device">
      <h2>${r.profile.name} <span class="meta">(${r.profile.engine})</span></h2>
      <p class="meta">
        viewport ${r.viewport.w}×${r.viewport.h} @${r.viewport.dpr}x ·
        nav ${r.navMs}ms ·
        <span class="${r.consoleErrors.length ? 'err' : 'ok'}">${r.consoleErrors.length} console errors</span> ·
        <span class="${r.networkErrors.length ? 'err' : 'ok'}">${r.networkErrors.length} network failures</span>
      </p>
      ${r.consoleErrors.length ? `<details><summary class="err">console errors</summary><pre>${escapeHtml(r.consoleErrors.join('\n'))}</pre></details>` : ''}
      ${r.networkErrors.length ? `<details><summary class="err">network failures</summary><pre>${escapeHtml(r.networkErrors.join('\n'))}</pre></details>` : ''}
      <div class="grid">${thumbs}</div>
    </div>`;
}).join('\n')}
</body></html>`;
    await fs.writeFile(path.join(OUT_DIR, 'index.html'), html);
}

function escapeHtml(s) {
    return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function listScreens(slug) {
    try {
        const files = await fs.readdir(path.join(OUT_DIR, slug));
        return files.filter(f => f.endsWith('.png')).sort();
    } catch { return []; }
}

run().catch(err => { console.error(err); process.exit(1); });
