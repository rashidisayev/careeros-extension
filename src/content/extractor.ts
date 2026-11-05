/**
 * Injected into the page with chrome.scripting.executeScript (files), only after the user
 * acted (toolbar, shortcut, context menu) or on a site they allowed. It defines one function
 * and returns; the background then calls it and receives plain data. No listeners, no
 * network, no storage: a page can't talk to it and it keeps nothing.
 */
import { extractPage } from "../extraction";

(globalThis as Record<string, unknown>).__careerosExtract = () => extractPage(document, location.href);
