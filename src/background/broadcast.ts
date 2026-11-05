/** Fire-and-forget notices to open extension pages (popup, side panel, options). */
import type { Broadcast } from "../shared/messages";

function send(message: Broadcast): void {
  // Rejects when no page is open to receive it; that is fine.
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

export const broadcastTab = (tabId: number) => send({ type: "broadcast.tab", tabId });
export const broadcastSession = () => send({ type: "broadcast.session" });
export const broadcastSettings = () => send({ type: "broadcast.settings" });
export const broadcastAutofill = (tabId: number) => send({ type: "broadcast.autofill", tabId });
