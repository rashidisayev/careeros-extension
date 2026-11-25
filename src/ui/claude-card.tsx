import { ExternalLink, Plug } from "lucide-react";
import { Button } from "./components";

/**
 * Points to GetCareer's Claude connector (MCP). The connection itself is made in Claude, which
 * signs in to GetCareer and asks for approval there; no Claude app offers a link that installs
 * a connector, so the button opens the setup steps on getcareer.io (Claude on the web needs no
 * install). Nothing here talks to Claude or holds a token.
 */
export function ClaudeCard({ onOpen }: { onOpen: (path: string) => void }) {
  return (
    <section aria-labelledby="claude-card-title" className="grid gap-1.5 rounded-xl border bg-card p-3 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 id="claude-card-title" className="flex items-center gap-2 font-medium">
          <Plug className="size-4 text-muted-foreground" aria-hidden />
          Connect with Claude
        </h2>
        <Button size="sm" variant="outline" onClick={() => onOpen("/mcp-server#claude")}>
          Connect to Claude <ExternalLink aria-hidden />
          <span className="sr-only">(opens the setup steps in a new tab)</span>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Ask Claude about your jobs and applications. You approve the connection on GetCareer.{" "}
        <Button variant="link" className="text-xs" onClick={() => onOpen("/mcp-server#tools")}>
          Learn more
        </Button>
      </p>
    </section>
  );
}
