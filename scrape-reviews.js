const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator,'webdriver',{get:()=>false}); });

  // Capture all responses looking for review data
  const captured = [];
  page.on('response', async res => {
    const url = res.url();
    if (url.includes('maps/api') || url.includes('review') || url.includes('localgst') || url.includes('preview/place') || url.includes('geoservice') || url.includes('gws-localreviews')) {
      try {
        const text = await res.text();
        if (text.includes('wiI7pd') || text.length > 500 && (text.includes('star') || text.includes('review'))) {
          captured.push({ url: url.slice(0,100), len: text.length, snippet: text.slice(0,300) });
        }
      } catch(e) {}
    }
  });

  // Try the direct CID URL
  console.log('Trying CID URL...');
  try {
    await page.goto('https://www.google.com/maps?cid=5270413286584517048', { waitUntil:'networkidle2', timeout:20000 });
  } catch(e) { console.log('timeout, continuing'); }
  await new Promise(r=>setTimeout(r,3000));

  const text1 = await page.evaluate(()=>document.body.innerText.slice(0,500));
  console.log('CID page snippet:', text1);
  console.log('Captured requests:', captured.length);
  captured.forEach(c => console.log(c.url, c.len, '\n', c.snippet.slice(0,200)));

  await browser.close();
})();
