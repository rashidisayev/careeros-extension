/**
 * Which pages the extension may read.
 *
 * Job platforms whose terms forbid automated access are never read automatically, the same
 * rule GetCareer applies to links (apps/api/app/job_imports/urls.py, RESTRICTED). On them the
 * extension only recognises the posting from its address and offers to save text the user
 * selects. The API enforces this too (a page capture from these hosts is refused), and its
 * lookup reports `restricted` for every link, so an outdated extension can't drift from it.
 */
export type RestrictedPlatform = { key: string; name: string };

const RESTRICTED: (RestrictedPlatform & { host: RegExp })[] = [
  { key: "linkedin", name: "LinkedIn", host: /(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/ },
  { key: "indeed", name: "Indeed", host: /(^|\.)indeed\.[a-z.]+$/ },
  { key: "glassdoor", name: "Glassdoor", host: /(^|\.)glassdoor\.[a-z.]+$/ },
  { key: "xing", name: "XING", host: /(^|\.)xing\.com$/ },
  { key: "stepstone", name: "StepStone", host: /(^|\.)stepstone\.[a-z.]+$/ },
  { key: "monster", name: "Monster", host: /(^|\.)monster\.[a-z.]+$/ },
];

export const RESTRICTED_KEYS = RESTRICTED.map((p) => p.key);

// Job-posting addresses on those platforms. Only for these is the address looked up in
// GetCareer (to show the status of a job you track); feeds, profiles and searches are not.
const RESTRICTED_JOB_PATH: Record<string, RegExp> = {
  linkedin: /^\/(comm\/)?jobs\/view\/(\d+|[^/]*-\d{6,})/,
  indeed: /^\/(viewjob|rc\/clk|pagead\/clk|m\/viewjob)/,
  glassdoor: /^\/(job-listing|Job\/.+-jobs-SRCH_.*JV_)/i,
  xing: /^\/jobs\/[^/]+-\d+/,
  stepstone: /^\/stellenangebote--|\/job\//i,
  monster: /^\/(job-openings|job)\//i,
};
const RESTRICTED_JOB_QUERY: Record<string, string[]> = {
  linkedin: ["currentJobId"],
  indeed: ["jk", "vjk"],
  glassdoor: ["jl"],
};

/** A posting's address on a restricted platform (not a search, feed or profile). */
export function isRestrictedJobUrl(url: string): boolean {
  const platform = restrictedPlatformFor(url);
  const u = parse(url);
  if (!platform || !u) return false;
  if (RESTRICTED_JOB_PATH[platform.key]?.test(u.pathname)) return true;
  return (RESTRICTED_JOB_QUERY[platform.key] ?? []).some((q) => /^[A-Za-z0-9_-]{4,64}$/.test(u.searchParams.get(q) ?? ""));
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function restrictedPlatformFor(url: string): RestrictedPlatform | null {
  const u = parse(url);
  if (!u) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const hit = RESTRICTED.find((p) => p.host.test(host));
  return hit ? { key: hit.key, name: hit.name } : null;
}

// Pages extensions can't or mustn't script: browser and store pages, and GetCareer itself.
const BLOCKED_HOSTS = /^(chromewebstore\.google\.com|chrome\.google\.com|microsoftedge\.microsoft\.com)$/;

export type PageKind = "web" | "careeros" | "unsupported";

export function pageKind(url: string | undefined, careerosOrigin: string): PageKind {
  const u = url ? parse(url) : null;
  if (!u || (u.protocol !== "https:" && u.protocol !== "http:")) return "unsupported";
  if (u.origin === careerosOrigin) return "careeros";
  if (BLOCKED_HOSTS.test(u.hostname)) return "unsupported";
  return "web";
}

/** The origin pattern to request optional host access for (https only, never all sites). */
export function originPattern(url: string): string | null {
  const u = parse(url);
  if (!u || u.protocol !== "https:") return null;
  return `https://${u.hostname}/*`;
}
