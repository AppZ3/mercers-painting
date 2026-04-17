const puppeteer = require('puppeteer');

const businesses = [
  { name: 'Bunnings Ballina', query: 'Bunnings+Warehouse+Ballina+NSW' },
  { name: 'Good Guys Ballina', query: 'The+Good+Guys+Ballina+NSW' },
  { name: 'Taco Bell Ballina', query: 'Taco+Bell+Ballina+NSW' },
  { name: 'KFC Ballina', query: 'KFC+Ballina+NSW' },
  { name: 'Harvey Norman Ballina', query: 'Harvey+Norman+Ballina+NSW' },
  { name: 'Shaws Bay Hotel bar', query: 'Shaws+Bay+Hotel+Ballina+bar' },
];

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator,'webdriver',{get:()=>false}); });

  for (const biz of businesses) {
    const url = `https://www.google.com/maps/search/${biz.query}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(()=>{});
    await new Promise(r => setTimeout(r, 3000));

    // Click first result
    try {
      await page.click('a[href*="/maps/place/"]');
      await new Promise(r => setTimeout(r, 3000));
    } catch(e) {}

    // Click Photos tab
    try {
      const photoBtn = await page.$('[aria-label*="Photo"], [data-tab-index="1"] button, button[jsaction*="photo"]');
      if (photoBtn) { await photoBtn.click(); await new Promise(r=>setTimeout(r,2000)); }
    } catch(e) {}

    // Grab image URLs
    const imgs = await page.evaluate(() => {
      return [...document.querySelectorAll('img[src*="googleusercontent"], img[src*="ggpht"]')]
        .map(i => i.src)
        .filter(s => s.includes('googleusercontent') && !s.includes('avatar'))
        .slice(0,3);
    });

    console.log(`\n=== ${biz.name} ===`);
    imgs.forEach(u => console.log(u));
    if (!imgs.length) {
      const snippet = await page.evaluate(() => document.body.innerText.slice(0,200));
      console.log('No imgs. Page:', snippet.slice(0,150));
    }
  }

  await browser.close();
})();
