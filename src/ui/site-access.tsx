/**
 * Optional, per-site access: lets the side panel read pages on one site as you move between
 * its postings, without clicking the icon each time. Asked for one site at a time
 * (https://host/*), never "all sites", and removable here or in Settings.
 */
import { useEffect, useState } from "react";
import { originPattern } from "../shared/policy";
import { Button } from "./components";
import { send } from "./client";

export function SiteAccess({ url }: { url: string | null }) {
  const pattern = url ? originPattern(url) : null;
  const host = url ? new URL(url).hostname : "";
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    if (!pattern) return;
    chrome.permissions.contains({ origins: [pattern] }).then(setGranted).catch(() => setGranted(null));
  }, [pattern]);
  if (!pattern || granted === null) return null;

  const toggle = async () => {
    // Must run in the click itself: the browser asks the user to confirm.
    const ok = granted
      ? await chrome.permissions.remove({ origins: [pattern] })
      : await chrome.permissions.request({ origins: [pattern] });
    if (ok) {
      setGranted(!granted);
      send({ type: "site.accessChanged" }).catch(() => undefined);
    }
  };
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
      {granted ? (
        <>
          Reads postings on <span className="font-medium text-foreground">{host}</span> while the panel is open.
          <Button variant="link" className="text-xs" onClick={toggle}>
            Stop
          </Button>
        </>
      ) : (
        <>
          <span>Moving between postings on {host}?</span>
          <Button variant="link" className="text-xs" onClick={toggle}>
            Read this site automatically
          </Button>
        </>
      )}
    </p>
  );
}
