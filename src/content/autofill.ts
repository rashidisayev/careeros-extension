/**
 * Injected with chrome.scripting.executeScript (files) when the user opens AutoFill on a tab
 * the extension may read (activeTab after a click, or a site they allowed). Creates the page
 * AutoFill object once per document and returns. No network and no storage: it acts when the
 * service worker calls it, and only with values the user reviewed. Its one listener watches
 * for new form fields (the next step of an application) and sends the extension a bare
 * "the form changed" notice, nothing from the page.
 */
import { createPageAutofill } from "../autofill/page";

const g = globalThis as Record<string, unknown>;
g.__careerosAutofill ??= createPageAutofill(document, () => {
  chrome.runtime.sendMessage({ type: "autofill.changed" }).catch(() => undefined);
});
