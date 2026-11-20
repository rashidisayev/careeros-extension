// Renders the Chrome Web Store images (four 1280x800 screenshots, the 440x280 promo tile) from the
// e2e screenshots. Run `STORE_SHOTS=1 pnpm test:e2e` (plain names) and `pnpm package` (dist-store) first.
//   node scripts/store-images.cjs . release/store-listing-<version>
const { createRequire } = require("node:module");
const { writeFileSync, mkdirSync, readdirSync } = require("node:fs");
const { resolve } = require("node:path");

const [root, out] = process.argv.slice(2).map((p) => resolve(p));
const req = createRequire(`${root}/package.json`);
const { chromium } = req("@playwright/test");
const S = `${root}/test-results/screens`;
const font = readdirSync(`${root}/dist-store/assets`).find((f) => f.startsWith("hanken-grotesk-latin-wght"));
const icon = `file://${root}/dist-store/icons/128.png`;

const css = `
@font-face { font-family: Hanken; src: url("file://${root}/dist-store/assets/${font}") format("woff2"); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
body { font-family: Hanken, -apple-system, sans-serif; color: oklch(0.95 0.006 220);
  background: radial-gradient(1200px 700px at 85% 40%, oklch(0.30 0.05 218) 0%, oklch(0.16 0.012 228) 60%); overflow: hidden; }
.brand { display: flex; align-items: center; gap: 12px; font-size: 22px; letter-spacing: -0.01em; }
.brand img { width: 40px; height: 40px; }
.brand b { font-weight: 700; }
.brand span { font-weight: 400; color: oklch(0.80 0.01 220); }
h1 { font-size: 46px; line-height: 1.1; font-weight: 700; letter-spacing: -0.02em; margin: 40px 0 22px; }
p { font-size: 21px; line-height: 1.45; color: oklch(0.80 0.015 222); }
ul { list-style: none; padding: 0; margin-top: 26px; }
li { font-size: 19px; line-height: 1.4; color: oklch(0.86 0.012 222); padding-left: 26px; position: relative; margin-bottom: 12px; }
li::before { content: ""; position: absolute; left: 0; top: 9px; width: 10px; height: 10px; border-radius: 50%; background: oklch(0.72 0.09 218); }
.frame { width: 420px; overflow: hidden; border-radius: 16px; border: 1px solid oklch(0.32 0.014 226);
  box-shadow: 0 30px 60px -20px rgba(0,0,0,.6), 0 0 0 6px rgba(255,255,255,.03); background: oklch(0.16 0.012 228); }
.frame img { display: block; width: 420px; }
`;

const crop = (file, top, bottom) =>
  `<div class="frame" style="height:${bottom - top}px"><img src="file://${S}/${file}" style="margin-top:-${top}px"></div>`;

const slide = (title, text, bullets, frames) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}
body { width: 1280px; height: 800px; display: grid; grid-template-columns: 560px 1fr; align-items: center; padding: 0 80px 0 90px; }
.shots { display: flex; flex-direction: column; gap: 22px; align-items: center; justify-self: center; }
</style></head><body>
<div><div class="brand"><img src="${icon}"><span>Get<b style="color:oklch(0.95 0.006 220)">Career</b> Companion</span></div>
<h1>${title}</h1><p>${text}</p><ul>${bullets.map((b) => `<li>${b}</li>`).join("")}</ul></div>
<div class="shots">${frames.join("")}</div></body></html>`;

const slides = [
  ["1-save-jobs", slide("Save any job posting in one click",
    "GetCareer reads the posting you're on. You check every field and save it to your applications.",
    ["See where each value came from", "Know at once if you already track the job", "Nothing is saved until you've checked it"],
    [crop("panel-detected-dark.png", 0, 360), crop("popup-tracked-dark.png", 240, 470)])],
  ["2-autofill", slide("Fill application forms from your Career Profile",
    "AutoFill finds the fields, shows what it will write, and fills only what you tick.",
    ["English and German forms", "Works with the common job application systems", "Never submits the application for you"],
    [crop("panel-autofill-summary-dark.png", 48, 296), crop("panel-autofill-history-review-dark.png", 1100, 1460)])],
  ["3-work-history", slide("Work history, dates and your CV",
    "Roles and education go into the right entry, with dates in the form's own format.",
    ["Your CV attached when you tick it", "A resume tailored to the job, written by GetCareer", "Every value editable before filling"],
    [crop("panel-autofill-history-review-dark.png", 572, 1092)])],
  ["4-in-control", slide("You stay in control",
    "Sensitive and legal questions are always left to you. Undo restores the form.",
    ["Never fills salary, visa, gender or consent boxes", "Reads a page only when you open it there", "Never reads your browsing history"],
    [crop("panel-autofill-result-dark.png", 150, 578), crop("options-autofill-dark.png", 2466, 2618)])],
];

const tile = `<!doctype html><html><head><meta charset="utf-8"><style>${css}
body { width: 440px; height: 280px; padding: 34px 36px; display: flex; flex-direction: column; justify-content: center;
  background: radial-gradient(500px 300px at 90% 10%, oklch(0.32 0.06 218) 0%, oklch(0.16 0.012 228) 70%); }
.brand { font-size: 26px; gap: 14px; } .brand img { width: 56px; height: 56px; }
h1 { font-size: 30px; margin: 26px 0 8px; } p { font-size: 16px; }
</style></head><body>
<div class="brand"><img src="${icon}"><span>Get<b style="color:oklch(0.95 0.006 220)">Career</b> Companion</span></div>
<h1>Save jobs. Fill applications.</h1><p>Your GetCareer account, right next to every job posting.</p></body></html>`;

(async () => {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const render = async (name, html, width, height) => {
    const file = `${out}/.${name}.html`;
    writeFileSync(file, html);
    await page.setViewportSize({ width, height });
    await page.goto(`file://${file}`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${out}/${name}.png`, type: "png" });
    require("node:fs").rmSync(file);
  };
  for (const [name, html] of slides) await render(`screenshot-${name}`, html, 1280, 800);
  await render("promo-small-440x280", tile, 440, 280);
  await browser.close();
  console.log("done");
})();
