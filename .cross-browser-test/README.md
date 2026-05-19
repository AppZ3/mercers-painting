# Mercer's cross-browser/device test harness

Lets us actually see what the site looks like on real device profiles, not just one viewport.

## Quick start (native, no Docker)

```sh
npm install
npm run install-browsers
node run.js                              # all profiles, live site
node run.js --only "Pixel"               # one device substring
node run.js --url https://staging.x.y    # different URL
```

Open `output/index.html` afterwards. Each device gets a row with thumbnails of every hero page in its "done" state plus mid-transition screenshots that expose any crossfade overlap.

## Running iOS Safari profiles

The three `webkit` profiles (iPhone SE / 13 / 13 Pro Max) need `libicu74` and `libflite1`. Arch Linux ships icu 78 not 74 so they will fail on this host. Two options:

1. **Docker (recommended).** The official Playwright image has all WebKit deps preinstalled.
   ```sh
   ./run-docker.sh                  # passes through to run.js inside the image
   ./run-docker.sh --only "iPhone"
   ```
2. **Install libicu74 from AUR.** `yay -S icu74`. Will rebuild from source, takes a while.

The Pixel / Galaxy / Samsung Internet / iPhone-shaped-chromium profiles run fine natively.

## What each profile catches

| Profile | Engine | What it covers |
|--------|--------|---------------|
| iPhone SE | webkit | Older Safari quirks, small DPR-2 screen common in NSW |
| iPhone 13 | webkit | Current mainstream iPhone |
| iPhone 13 Pro Max | webkit | Closest to iPhone 15 Pro, DPR 3 |
| iPhone 13 (chromium UA) | chromium | Layout/JS without WebKit paint (native fallback) |
| Pixel 7 | chromium | Stock Android Chrome |
| Galaxy S9+ | chromium | Large Android, DPR 4.5 |
| Samsung Internet (Galaxy) | chromium | Samsung's chromium fork, popular in older Android demographic |

## What the harness actually does

Per profile:
1. Sets viewport, DPR, user agent, touch from the device descriptor.
2. CPU throttle 4×, network ~4 Mbps / 150 ms latency (chromium only — webkit doesn't expose throttling).
3. Loads cold (no shared cache between profiles since each gets a new browser context).
4. Captures console + network errors.
5. Screenshots page 0, then sweeps every dot in the hero. For each transition it captures both the post-fade "done" state AND a mid-transition screenshot. The mid-transition shot is where any half-half overlap bug would be visible.
6. Pulls `performance.getEntriesByType('resource')` to see which images finished downloading before the first 4.5s auto-rotate would have fired.
7. Writes `summary.json` per device and a unified `output/index.html` for visual diff.
