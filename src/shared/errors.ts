import type { ErrorInfo } from "./types";

/** Error carried across the extension (API, network, browser). */
export class ExtensionError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
    public details?: unknown,
    public requestId?: string | null,
  ) {
    super(message);
    this.name = "ExtensionError";
  }

  toInfo(): ErrorInfo {
    return { code: this.code, message: this.message, status: this.status, details: this.details, requestId: this.requestId };
  }
}

/** Plain-language messages for codes the API doesn't word itself. */
const MESSAGES: Record<string, string> = {
  network_error: "GetCareer can't be reached. Check your connection and try again.",
  offline: "You're offline. Connect to the internet and try again.",
  timeout: "GetCareer took too long to answer. Try again in a moment.",
  server_error: "GetCareer had a problem. Try again in a moment.",
  not_connected: "Connect the extension to your GetCareer account first.",
  invalid_session: "Your connection to GetCareer ended. Connect again to continue.",
  connect_cancelled: "Connecting was cancelled.",
  connect_failed: "Connecting didn't work. Try again.",
  no_access: "The extension can't read this tab. Click the GetCareer icon on the page to read it.",
  extraction_failed: "This page couldn't be read.",
  update_required: "This version of the extension is too old for GetCareer. Update it to continue.",
  unknown: "Something went wrong. Try again.",
};

export function messageFor(code: string, fallback?: string): string {
  return MESSAGES[code] ?? fallback ?? MESSAGES.unknown!;
}

export function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof ExtensionError) return error.toInfo();
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const e = error as ErrorInfo;
    return { code: String(e.code), message: String(e.message), status: e.status, details: e.details };
  }
  return { code: "unknown", message: messageFor("unknown") };
}
