/**
 * The real extension in Chromium against a running CareerOS:
 *   connect (the real chrome.identity window and the website's connect page, when the browser
 *   exposes that window; otherwise the same API calls), read a job page, review and save in
 *   the side panel, see the status, and the popup. Screenshots go to test-results/screens.
 *
 *   docker compose up && pnpm test:e2e
 */
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const DIST = resolve(ROOT, "dist-e2e");
const API = "http://localhost:3000/api/v1";
const run = Date.now().toString(36);
const EMAIL = `ext-e2e-${run}@example.com`;
const PASSWORD = `E2e-test-${run}-pw!`;
const COMPANY = `Northwind E2E ${run}`;
const SHOTS = resolve(ROOT, "test-results/screens");
const SNAPS = resolve(ROOT, "test-results/snapshots");

// One browser, one account, steps in order: a failure stops the rest instead of re-running setup.
test.describe.configure({ mode: "serial" });

let server: Server;
let port = 0;
let context: BrowserContext;
let sw: Worker;
let extensionId = "";
const jar = new Map<string, string>();

function remember(res: Response) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const [name, ...rest] = pair!.split("=");
    jar.set(name!.trim(), rest.join("="));
  }
}
async function web(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: Array.from(jar, ([k, v]) => `${k}=${v}`).join("; "), "X-CSRF-Token": jar.get("careeros_csrf") ?? "" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  remember(res);
  return res;
}

function fixture(name: string): string {
  return readFileSync(resolve(ROOT, "test/fixtures/pages", name), "utf8")
    .replaceAll("Northwind Logistics GmbH", COMPANY)
    .replaceAll("https://careers.northwind.example", `http://127.0.0.1:${port}`);
}

function form(name: string): string {
  return readFileSync(resolve(ROOT, "test/fixtures/forms", name), "utf8");
}

async function tabIdFor(url: string): Promise<number> {
  return sw.evaluate(async (u) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => t.url === u)?.id ?? -1;
  }, url);
}

/**
 * A static copy of the rendered page (styles inlined, scripts removed) for the Impeccable
 * detector, which needs a real page but can't open chrome-extension:// pages itself.
 */
async function snapshot(page: Page, name: string) {
  const html = await page.evaluate(async () => {
    const doc = document.documentElement.cloneNode(true) as HTMLElement;
    doc.querySelectorAll("script, link[rel=modulepreload]").forEach((n) => n.remove());
    for (const link of Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))) {
      const css = await (await fetch((link as HTMLLinkElement).href)).text();
      const style = document.createElement("style");
      style.textContent = css.replace(/url\(\.\/(hanken[^)]+)\)/g, `url(${location.origin}/assets/$1)`);
      link.replaceWith(style);
    }
    return `<!doctype html>${doc.outerHTML}`;
  });
  mkdirSync(SNAPS, { recursive: true });
  writeFileSync(`${SNAPS}/${name}.html`, html);
}

async function setTheme(theme: "dark" | "light") {
  await sw.evaluate(async (t) => {
    const got = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { version: 1, ...(got.settings as object), theme: t } });
  }, theme);
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const forms: Record<string, string> = { "/apply/en": "simple-en.html", "/apply/de": "simple-de.html", "/apply/steps": "steps.html" };
    const formName = forms[req.url?.split("?")[0] ?? ""];
    if (formName) return void res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(form(formName));
    const name = req.url?.startsWith("/jobs/4711") ? "jsonld-basic.html" : req.url?.startsWith("/blog") ? "not-job.html" : null;
    if (!name) return void res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(fixture(name));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;

  const reg = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, full_name: "Extension E2E", accept_terms: true, accept_privacy: true }),
  });
  expect(reg.status).toBe(201);
  remember(reg);

  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 420, height: 900 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  extensionId = new URL(sw.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  server?.close();
  await web("/privacy/delete-account", "POST", { password: PASSWORD, confirm: "DELETE" });
});

test("loads with the expected id, permissions and no errors", async () => {
  expect(extensionId).toBe("ajbdeolccbgjinhdmllogiefhmcogpma");
  const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.permissions).toEqual(["activeTab", "scripting", "storage", "sidePanel", "identity", "contextMenus"]);
  expect(manifest.optional_host_permissions).toEqual(["https://*/*"]);
});

test("not connected: the popup offers to connect", async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByRole("heading", { name: "Connect to your CareerOS account" })).toBeVisible();
  await expect(popup.getByRole("button", { name: "Connect to CareerOS" })).toBeEnabled();
  await popup.screenshot({ path: `${SHOTS}/popup-connect-dark.png` });
  await snapshot(popup, "popup-connect-dark");
  await popup.close();
});

test("connects through the CareerOS website", async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const authWindow = context.waitForEvent("page", { timeout: 10_000 }).catch(() => null);
  await options.getByRole("button", { name: "Connect to CareerOS" }).click();
  const auth = await authWindow;
  if (auth) {
    // The real chrome.identity window: sign in on the website, then approve.
    await auth.waitForLoadState();
    await auth.screenshot({ path: `${SHOTS}/connect-window-login.png` });
    await auth.getByLabel("Email").fill(EMAIL);
    await auth.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await auth.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(auth.getByRole("button", { name: /connect/i })).toBeVisible({ timeout: 20_000 });
    await auth.screenshot({ path: `${SHOTS}/connect-window-approve.png` });
    await auth.getByRole("button", { name: /^connect/i }).click();
  } else {
    test.info().annotations.push({ type: "note", description: "The identity window isn't exposed to Playwright; connected via the same API calls." });
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const redirect = `https://${extensionId}.chromiumapp.org/careeros`;
    const a = await web("/auth/extension/authorize", "POST", { redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state: "e2e-state-0123456789", client_name: "CareerOS Companion e2e" });
    const code = new URL(((await a.json()) as { redirect_to: string }).redirect_to).searchParams.get("code");
    const t = await (await fetch(`${API}/auth/extension/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirect }) })).json();
    await sw.evaluate(async (tokens) => {
      const db: IDBDatabase = await new Promise((ok, no) => {
        const r = indexedDB.open("careeros-vault", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("secrets");
        r.onsuccess = () => ok(r.result);
        r.onerror = () => no(r.error);
      });
      await new Promise((ok) => {
        const tx = db.transaction("secrets", "readwrite");
        tx.objectStore("secrets").put({ sessionId: tokens.session_id, refreshToken: tokens.refresh_token, refreshExpiresAt: tokens.refresh_token_expires_at, user: tokens.user }, "session");
        tx.oncomplete = ok;
      });
      await chrome.storage.session.set({ "auth.access": { token: tokens.access_token, expiresAt: Date.parse(tokens.access_token_expires_at) } });
      await chrome.runtime.sendMessage({ type: "broadcast.session" }).catch(() => undefined);
    }, t);
    await options.reload();
  }
  await expect(options.getByText(EMAIL)).toBeVisible({ timeout: 20_000 });
  await options.screenshot({ path: `${SHOTS}/options-dark.png`, fullPage: true });
  await snapshot(options, "options-dark");
  await options.close();
});

test("reads a job page, reviews and saves it in the side panel, then shows its status", async () => {
  const job = await context.newPage();
  const jobUrl = `http://127.0.0.1:${port}/jobs/4711-senior-sre`;
  await job.goto(jobUrl);
  const tabId = await tabIdFor(jobUrl);
  expect(tabId).toBeGreaterThan(0);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await expect(panel.getByRole("heading", { name: "Senior Site Reliability Engineer" })).toBeVisible();
  await expect(panel.getByText(COMPANY)).toBeVisible();
  await expect(panel.getByText("EUR 85,000–105,000 per year")).toBeVisible();
  await panel.screenshot({ path: `${SHOTS}/panel-detected-dark.png`, fullPage: true });
  await snapshot(panel, "panel-detected-dark");

  await panel.getByRole("button", { name: "Review and save" }).click();
  await expect(panel.getByRole("heading", { name: "Review the job details" })).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByLabel("Position")).toHaveValue("Senior Site Reliability Engineer");
  await expect(panel.getByLabel("Company")).toHaveValue(COMPANY);
  await expect(panel.getByText("From the posting").first()).toBeVisible();
  await panel.screenshot({ path: `${SHOTS}/panel-review-dark.png`, fullPage: true });
  await panel.screenshot({ path: `${SHOTS}/panel-review-viewport-dark.png` });
  await snapshot(panel, "panel-review-dark");

  // Keyboard: correct a value, choose a status, save.
  await panel.getByLabel("Department").fill("Platform");
  await expect(panel.getByText("Edited")).toBeVisible();
  await panel.getByLabel("Status").selectOption("to_apply");
  await panel.getByRole("button", { name: "Save to CareerOS" }).click();
  await expect(panel.getByText("Saved to your applications")).toBeVisible({ timeout: 30_000 });
  await panel.screenshot({ path: `${SHOTS}/panel-saved-dark.png`, fullPage: true });
  await snapshot(panel, "panel-saved-dark");

  await panel.getByRole("button", { name: "Done" }).click();
  await expect(panel.getByRole("heading", { name: "Already in your applications" })).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText("To apply")).toBeVisible();
  await panel.screenshot({ path: `${SHOTS}/panel-tracked-dark.png`, fullPage: true });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  await expect(popup.getByText("Already in your applications")).toBeVisible();
  await popup.screenshot({ path: `${SHOTS}/popup-tracked-dark.png` });

  await setTheme("light");
  await popup.reload();
  await expect(popup.getByText("Already in your applications")).toBeVisible();
  await popup.screenshot({ path: `${SHOTS}/popup-tracked-light.png` });
  await snapshot(popup, "popup-tracked-light");
  await panel.reload();
  await expect(panel.getByRole("heading", { name: "Already in your applications" })).toBeVisible();
  await panel.screenshot({ path: `${SHOTS}/panel-tracked-light.png`, fullPage: true });

  // Saving again shows the duplicate, and offers only "open" or "separate".
  await panel.getByRole("button", { name: "Review and save as a separate application" }).click();
  await expect(panel.getByText("You may already be tracking this job")).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByRole("button", { name: "Open the existing application" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Save to CareerOS" })).toHaveCount(0);
  await panel.screenshot({ path: `${SHOTS}/panel-duplicate-light.png`, fullPage: true });
  await snapshot(panel, "panel-duplicate-light");
  await panel.getByRole("button", { name: "Cancel" }).click();
  await setTheme("dark");
});

test("a page that isn't a job says so and sends nothing", async () => {
  const blog = await context.newPage();
  const url = `http://127.0.0.1:${port}/blog/cloud-bill`;
  await blog.goto(url);
  const tabId = await tabIdFor(url);
  const requests: string[] = [];
  context.on("request", (r) => r.url().includes("/extension/lookup") && requests.push(r.url()));
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  await expect(popup.getByText("No job posting found on this page")).toBeVisible();
  await popup.screenshot({ path: `${SHOTS}/popup-not-job-dark.png` });
  await snapshot(popup, "popup-not-job-dark");
  expect(requests).toEqual([]);
});

test("AutoFill: fills an application form from the Career Profile, after review, and undoes it", async () => {
  // The Career Profile in CareerOS is the only source of the values.
  const prof = await web("/career-profile", "PATCH", {
    given_name: "Erika",
    family_name: "Mustermann",
    phone: "+49 151 2345678",
    location: "Berlin",
    country: "DE",
    current_title: "Head of Platform",
    years_of_experience: 12,
    has_management_experience: true,
    linkedin_url: "https://www.linkedin.com/in/erika-e2e",
    github_url: "https://github.com/erika-e2e",
  });
  expect(prof.status).toBe(200);
  expect((await web("/career-profile/experience", "POST", { company: "Nordlicht Payments", job_title: "Head of Platform", is_current: true })).status).toBe(201);

  const page = await context.newPage();
  const url = `http://127.0.0.1:${port}/apply/en`;
  await page.goto(url);
  const tabId = await tabIdFor(url);
  let submitted = false;
  page.on("request", (r) => r.method() === "POST" && (submitted = true));

  // The popup shows the contextual AutoFill card.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  await expect(popup.getByRole("heading", { name: "CareerOS AutoFill" })).toBeVisible({ timeout: 20_000 });
  await expect(popup.getByText("19 fields detected")).toBeVisible();
  await expect(popup.getByRole("button", { name: "Fill application" })).toBeVisible();
  await popup.screenshot({ path: `${SHOTS}/popup-autofill-dark.png` });
  await popup.close();

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await expect(panel.getByRole("heading", { name: "CareerOS AutoFill" })).toBeVisible({ timeout: 20_000 });
  await expect(panel.locator("html")).toHaveClass(/\bdark\b/); // the theme set at the end of the job test
  await expect(panel.getByText("11 fields ready to fill")).toBeVisible();
  await expect(panel.getByText("1 field needs your confirmation")).toBeVisible();
  await expect(panel.getByText("7 fields need your input")).toBeVisible();
  await panel.screenshot({ path: `${SHOTS}/panel-autofill-summary-dark.png`, fullPage: true });
  await snapshot(panel, "panel-autofill-summary-dark");

  // Review: every value visible and editable; sensitive questions only listed.
  await panel.getByRole("button", { name: "Fill application" }).click();
  await expect(panel.getByRole("heading", { name: "Review AutoFill" })).toBeVisible();
  await expect(panel.getByLabel("Value for First name")).toHaveValue("Erika");
  await expect(panel.getByLabel("Value for Current employer")).toHaveValue("Nordlicht Payments");
  await expect(panel.getByText("Sensitive or legal. CareerOS never fills this; answer it yourself.").first()).toBeVisible();
  await panel.getByLabel("Value for City").fill("Potsdam");
  await panel.screenshot({ path: `${SHOTS}/panel-autofill-review-dark.png`, fullPage: true });
  await snapshot(panel, "panel-autofill-review-dark");
  await panel.getByRole("button", { name: "Fill 11 fields" }).click();

  await expect(panel.getByText("Filled 11 fields")).toBeVisible({ timeout: 20_000 });
  await panel.screenshot({ path: `${SHOTS}/panel-autofill-result-dark.png`, fullPage: true });
  await snapshot(panel, "panel-autofill-result-dark");
  await expect(page.locator("#fn")).toHaveValue("Erika");
  await expect(page.locator("#ln")).toHaveValue("Mustermann");
  await expect(page.locator("#em")).toHaveValue(EMAIL);
  await expect(page.locator("#city")).toHaveValue("Potsdam");
  await expect(page.locator("#country")).toHaveValue("DE");
  await expect(page.locator("#yoe")).toHaveValue("12");
  await expect(page.locator("#org")).toHaveValue("Nordlicht Payments");
  // Left to the user: the suggestion they didn't confirm, consent, salary, legal questions.
  await expect(page.locator("input[name=mgmt]:checked")).toHaveCount(0);
  await expect(page.locator("input[name=privacy]")).not.toBeChecked();
  await expect(page.locator("#salary")).toHaveValue("");
  await expect(page.locator("#auth")).toHaveValue("");
  await expect(page.locator("#fn")).toHaveCSS("outline-style", "solid");
  await expect(page.locator("#cv")).toHaveCSS("outline-style", "dashed");
  await page.screenshot({ path: `${SHOTS}/form-autofilled.png`, fullPage: true });
  expect(submitted).toBe(false);
  expect(page.url()).toBe(url);

  // The user corrects a field; undo keeps that correction and clears the rest.
  await page.locator("#ln").fill("Mustermann-Weber");
  await panel.getByRole("button", { name: "Undo AutoFill" }).click();
  await expect(page.locator("#fn")).toHaveValue("");
  await expect(page.locator("#country")).toHaveValue("");
  await expect(page.locator("#ln")).toHaveValue("Mustermann-Weber");
  await expect(panel.getByRole("heading", { name: "CareerOS AutoFill" })).toBeVisible();
  expect(submitted).toBe(false);
});

test("AutoFill: German form", async () => {
  const page = await context.newPage();
  const url = `http://127.0.0.1:${port}/apply/de`;
  await page.goto(url);
  const tabId = await tabIdFor(url);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByRole("button", { name: "Fill application" }).click({ timeout: 20_000 });
  await panel.getByRole("button", { name: /^Fill \d+ fields$/ }).click();
  await expect(panel.getByText(/^Filled \d+ fields$/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#vn")).toHaveValue("Erika");
  await expect(page.locator("#tel")).toHaveValue("+49 151 2345678");
  await expect(page.locator("#ort")).toHaveValue("Berlin");
  await expect(page.locator("#land")).toHaveValue("de");
  await expect(page.locator("#be")).toHaveValue("mehr als 10 Jahre");
  // Never filled: salutation, date of birth, nationality, salary, start date.
  for (const id of ["#anrede", "#geb", "#nat", "#gv", "#et"]) await expect(page.locator(id)).toHaveValue("");
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#vn")).toHaveCSS("outline-style", "none");
});

test("AutoFill settings", async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#autofill`);
  await expect(options.getByRole("heading", { name: "AutoFill" })).toBeVisible();
  await expect(options.getByLabel("Offer AutoFill on application forms")).toBeChecked();
  await options.getByText(/^Fields \(/).click();
  // Settings are saved through the service worker; the box reflects the saved state.
  const phone = options.getByLabel("Phone", { exact: true });
  await phone.click();
  await expect(phone).not.toBeChecked();
  await options.screenshot({ path: `${SHOTS}/options-autofill-dark.png`, fullPage: true });
  const excluded = await sw.evaluate(async () => ((await chrome.storage.local.get("settings")).settings as { autofill: { excluded: string[] } }).autofill.excluded);
  expect(excluded).toEqual(["phone"]);
  const enabled = options.getByLabel("Offer AutoFill on application forms");
  await enabled.click();
  await expect(enabled).not.toBeChecked();
  const page = await context.newPage();
  const url = `http://127.0.0.1:${port}/apply/en`;
  await page.goto(url);
  const tabId = await tabIdFor(url);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await expect(panel.getByText("No job posting found on this page")).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByRole("heading", { name: "CareerOS AutoFill" })).toHaveCount(0);
  await enabled.click();
  await expect(enabled).toBeChecked();
  await phone.click();
  await expect(phone).toBeChecked();
});

/** A minimal valid PDF, so CareerOS accepts the upload. */
function tinyPdf(): Buffer {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>"];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

test("AutoFill: work history, a list widget, a CV from CareerOS, and the next step of the form", async () => {
  // A second, earlier role and a degree in the Career Profile; a CV uploaded to CareerOS.
  expect((await web("/career-profile/experience", "POST", { company: "Kiezbank", job_title: "Senior SRE", start_date: "2017-09-01", end_date: "2021-03-01" })).status).toBe(201);
  expect((await web("/career-profile/education", "POST", { institution: "TU Berlin", degree: "Master of Science", field_of_study: "Computer Science", start_year: 2011, graduation_year: 2013 })).status).toBe(201);
  const upload = new FormData();
  upload.append("file", new Blob([new Uint8Array(tinyPdf())], { type: "application/pdf" }), "erika-cv.pdf");
  const up = await fetch(`${API}/resumes/upload`, {
    method: "POST",
    headers: { Cookie: Array.from(jar, ([k, v]) => `${k}=${v}`).join("; "), "X-CSRF-Token": jar.get("careeros_csrf") ?? "" },
    body: upload,
  });
  expect(up.status).toBe(201);

  const page = await context.newPage();
  const url = `http://127.0.0.1:${port}/apply/steps`;
  await page.goto(url);
  const tabId = await tabIdFor(url);
  let submitted = false;
  page.on("request", (r) => r.method() === "POST" && (submitted = true));

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=${tabId}`);
  await panel.getByRole("button", { name: "Fill application" }).click({ timeout: 20_000 });
  await expect(panel.getByRole("heading", { name: "Review AutoFill" })).toBeVisible();
  await expect(panel.getByText("Employer · role 2")).toBeVisible();
  // The CV and the country list are suggestions: unticked until the user ticks them.
  const cv = panel.getByRole("checkbox", { name: "CV" });
  const country = panel.getByRole("checkbox", { name: "Country" });
  await expect(cv).not.toBeChecked();
  await expect(country).not.toBeChecked();
  await expect(panel.getByLabel("Document for CV")).toContainText("erika-cv.pdf");
  await cv.check();
  await country.check();
  await panel.screenshot({ path: `${SHOTS}/panel-autofill-history-review-dark.png`, fullPage: true });
  await panel.getByRole("button", { name: /^Fill \d+ fields$/ }).click();
  await expect(panel.getByText(/^Filled \d+ fields$/)).toBeVisible({ timeout: 30_000 });

  await expect(page.locator("#c0")).toHaveValue("Nordlicht Payments");
  await expect(page.locator("#t0")).toHaveValue("Head of Platform");
  await expect(page.locator("#c1")).toHaveValue("Kiezbank");
  await expect(page.locator("#s1")).toHaveValue("09/2017");
  await expect(page.locator("#country")).toHaveText("Germany");
  const attached = await page.locator("#cv").evaluate(async (el: HTMLInputElement) => {
    const f = el.files?.[0];
    return f ? { name: f.name, type: f.type, head: (await f.text()).slice(0, 8) } : null;
  });
  expect(attached).toEqual({ name: "erika-cv.pdf", type: "application/pdf", head: "%PDF-1.4" });

  // The next step: the page swaps in new fields; the panel offers them.
  await page.locator("#next").click();
  await expect(panel.getByText("New fields on the page")).toBeVisible({ timeout: 20_000 });
  await panel.screenshot({ path: `${SHOTS}/panel-autofill-next-step-dark.png`, fullPage: true });
  await panel.getByRole("button", { name: "Fill this step" }).click();
  await expect(panel.getByRole("heading", { name: "Review AutoFill" })).toBeVisible();
  await expect(panel.getByLabel("Value for University")).toHaveValue("TU Berlin");
  await panel.getByRole("button", { name: /^Fill \d+ fields?$/ }).click();
  await expect(panel.getByText(/^Filled \d+ fields?$/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#uni")).toHaveValue("TU Berlin");
  await expect(page.locator("#gy")).toHaveValue("2013");
  // The degree list is a suggestion (unticked), the open question is the user's.
  await expect(page.locator("#deg")).toHaveValue("");
  await expect(page.locator("#why")).toHaveValue("");
  expect(submitted).toBe(false);

  // One history entry for both steps (the English and German forms above have one each),
  // with counts and the file name, never form values.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#autofill`);
  await options.getByText(/^AutoFill history \(/).click();
  await expect(options.getByText("AutoFill history (3)")).toBeVisible({ timeout: 20_000 });
  await expect(options.getByText(/\d+ filled, 2 confirmed by you, 1 left to you · erika-cv\.pdf/)).toBeVisible();
  await expect(options.getByText("Kiezbank")).toHaveCount(0);
  await options.screenshot({ path: `${SHOTS}/options-autofill-history-dark.png`, fullPage: true });
});
