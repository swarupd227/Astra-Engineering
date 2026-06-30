import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('https://books.toscrape.com/');
  const actualPageUrl = page.url();
  const base = 'https://books.toscrape.com';

  const hrefs = await page.evaluate(({ base, actualPageUrl }) => {
    try {
      const seen = new Set();
      const out = [];
      const resolve = (href) => {
        if (!href || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("data:")) return null;
        if (href.startsWith("#") && !href.startsWith("#/") && !href.startsWith("#!/")) return null;
        try {
          // Resolve relative to the actual current page URL
          const u = new URL(href, actualPageUrl);
          if (u.hash && !u.hash.startsWith("#/") && !u.hash.startsWith("#!/")) {
              u.hash = "";
          }
          const s = u.toString().replace(/\/$/, "") || "/";
          if (seen.has(s)) return null;
          seen.add(s);
          
          // Allow links if they match either the original base hostname OR the current page's actual hostname
          const baseU = new URL(base);
          const currentU = new URL(actualPageUrl);
          
          const normHost = (h) => h.replace(/^www\./, "");
          const targetHost = normHost(u.hostname);
          
          if (targetHost !== normHost(baseU.hostname) && targetHost !== normHost(currentU.hostname)) {
            return null;
          }
          
          return s;
        } catch(e) {
          return null; // "URL_ERROR: " + String(e);
        }
      };
      const links = document.querySelectorAll("a[href]");
      for (let i = 0; i < links.length; i++) {
        const a = links[i];
        const h = a.href;
        const s = resolve(h);
        if (s) out.push(s);
      }
      return [...new Set(out)];
    } catch(e) {
      return ["ERROR: " + String(e) + " " + (e && e.stack)];
    }
  }, { base, actualPageUrl }).catch((e) => ["PUPPETEER_CATCH: " + String(e)]);

  console.log("Extracted:", hrefs.length);
  if (hrefs.length > 0) {
     console.log(hrefs.slice(0, 5));
  }
  await browser.close();
})();
