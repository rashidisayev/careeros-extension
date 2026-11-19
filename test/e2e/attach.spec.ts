/**
 * Attaching a file in a real browser, without GetCareer: AutoFill's page script on the fixture
 * forms of every supported ATS, with a real DataTransfer and real layout. A file counts as
 * attached only when the form shows it: the browser's own visible file control holds it, or an
 * upload widget lists its name. A hidden input nobody reacts to stays "unconfirmed", an
 * upload error is "file_rejected". Nothing is ever submitted.
 *
 *   pnpm test:e2e test/e2e/attach.spec.ts      (needs only the dist-e2e build)
 */
import { chromium, expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(ROOT, "dist-e2e/autofill.js");
const REF = "job-resume:6f1c2a9e-3b7d-4c51-9a0e-2d8f4b7c1e55";
const NAME = "Anna_Schmidt_Resume.pdf";
const FILE = { name: NAME, mime: "application/pdf", base64: Buffer.from("%PDF-1.7\n%tailored resume\n").toString("base64") };

let server: Server;
let base = "";
let browser: Browser;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const name = (req.url ?? "/").slice(1).split("?")[0]!;
    if (!/^[a-z0-9-]+\.html$/.test(name)) return void res.writeHead(404).end();
    try {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(readFileSync(resolve(ROOT, "test/fixtures/forms", name), "utf8"));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true });
});

test.afterAll(async () => {
  await browser?.close();
  server?.close();
});

type Field = { id: string; kind: string; label: string };

/** Opens a fixture form with AutoFill's page script, as the extension injects it. */
async function open(fixture: string): Promise<Page> {
  const page = await browser.newPage();
  // The page script tells the extension when the form changes; here nobody listens.
  await page.addInitScript(() => Object.assign(window, { chrome: { runtime: { sendMessage: async () => undefined } } }));
  await page.goto(`${base}/${fixture}`);
  await page.addScriptTag({ path: SCRIPT });
  return page;
}

async function attachTo(page: Page, pick: (fields: Field[]) => Field | undefined) {
  const fields = (await page.evaluate(() => (globalThis as unknown as { __careerosAutofill: { scan: () => { fields: Field[] } } }).__careerosAutofill.scan().fields)) as Field[];
  const field = pick(fields.filter((f) => f.kind === "file"));
  if (!field) throw new Error("no file field");
  const origin = new URL(page.url()).origin;
  const [out] = (await page.evaluate(
    ([id, o, ref, file]) =>
      (globalThis as unknown as { __careerosAutofill: { fill: (...a: unknown[]) => Promise<{ status: string }[]> } }).__careerosAutofill.fill(
        [{ frameId: 0, fieldId: id, frameOrigin: o, overwrite: false, value: { kind: "file", ref, format: "pdf", name: (file as { name: string }).name } }],
        0,
        o,
        { [`${ref}|pdf`]: file },
      ),
    [field.id, origin, REF, FILE] as const,
  )) as { status: string }[];
  return { status: out!.status, field };
}

const cv = (fields: Field[]) => fields.find((f) => /resume|cv|lebenslauf/i.test(f.label)) ?? fields[0];

// Forms whose CV input the browser shows itself: the file is visibly in the field.
for (const fixture of [
  "simple-en.html",
  "simple-de.html",
  "history-generic.html",
  "steps.html",
  "greenhouse-form.html",
  "lever-form.html",
  "workday-experience.html",
  "ats-ashby.html",
  "ats-personio.html",
  "ats-recruitee.html",
  "ats-teamtailor.html",
  "ats-workable.html",
]) {
  test(`attaches the tailored resume to the CV field: ${fixture}`, async () => {
    const page = await open(fixture);
    const { status } = await attachTo(page, cv);
    expect(status).toBe("filled");
    const names = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')).flatMap((i) => Array.from(i.files ?? []).map((f) => `${f.name}|${f.type}|${f.size}`)));
    expect(names).toEqual([`${NAME}|application/pdf|${Buffer.from(FILE.base64, "base64").length}`]);
    // Nothing was submitted.
    expect(new URL(page.url()).pathname).toBe(`/${fixture}`);
    await page.close();
  });
}

test("a hidden input nobody shows stays unconfirmed (Greenhouse's board markup without its script)", async () => {
  const page = await open("greenhouse-job-boards.html");
  expect((await attachTo(page, cv)).status).toBe("unconfirmed");
  await page.close();
});

test("upload widgets: listed is attached, silence is unconfirmed, an error is a refusal", async () => {
  const page = await open("upload-widgets.html");
  const by = (label: string) => (fields: Field[]) => fields.find((f) => f.label === label);
  expect((await attachTo(page, by("Resume/CV"))).status).toBe("filled");
  await expect(page.locator("#drop-zone .chosen")).toHaveText(NAME);
  // Keeps the file itself and empties the input: still attached, the widget lists it.
  expect((await attachTo(page, by("Writing sample"))).status).toBe("filled");
  expect((await attachTo(page, by("Cover letter"))).status).toBe("unconfirmed");
  expect((await attachTo(page, by("Portfolio"))).status).toBe("file_rejected");
  await page.close();
});
