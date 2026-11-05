/** Pages talk to the background service worker only through these typed messages. */
import type { Broadcast, Request, Response, ResponseMap } from "../shared/messages";
import type { ErrorInfo } from "../shared/types";

export class UiError extends Error {
  constructor(public info: ErrorInfo) {
    super(info.message);
  }
  get code() {
    return this.info.code;
  }
}

export async function send<K extends Request["type"]>(req: Extract<Request, { type: K }>): Promise<ResponseMap[K]> {
  let res: Response<ResponseMap[K]> | undefined;
  try {
    res = (await chrome.runtime.sendMessage(req)) as Response<ResponseMap[K]> | undefined;
  } catch {
    res = undefined;
  }
  if (!res) throw new UiError({ code: "unknown", message: "The extension didn't answer. Close this and try again." });
  if (!res.ok) throw new UiError(res.error);
  return res.data;
}

export function errorInfo(err: unknown): ErrorInfo {
  if (err instanceof UiError) return err.info;
  return { code: "unknown", message: "Something went wrong. Try again." };
}

export function onBroadcast(fn: (b: Broadcast) => void): () => void {
  const listener = (msg: unknown, sender: chrome.runtime.MessageSender) => {
    if (sender.id !== chrome.runtime.id) return false;
    const m = msg as { type?: unknown };
    if (typeof m?.type === "string" && m.type.startsWith("broadcast.")) fn(m as Broadcast);
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
