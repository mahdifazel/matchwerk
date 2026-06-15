// Shared text normalization for cross-source duplicate detection. The exact
// dedupe hash, the fuzzy matcher, and the blocking keys all import from here so
// every stage agrees on what makes two listings "the same" company / city /
// title. Previously dedupe.ts and similarity.ts normalized differently (e.g.
// only the matcher stripped company legal suffixes), which let near-duplicates
// slip past whichever stage was weaker.

/** Trailing company tokens stripped so "Zalando SE" == "Zalando GmbH" == "Zalando". */
const COMPANY_SUFFIX_TOKENS = new Set([
  "gmbh",
  "mbh",
  "ag",
  "se",
  "ug",
  "kg",
  "ltd",
  "limited",
  "inc",
  "llc",
  "bv",
  "co",
  "and", // from "& Co" → "and co"; only stripped when trailing
]);

/** City tokens that are noise for matching: country, region, qualifiers. */
const CITY_NOISE = new Set([
  "germany",
  "deutschland",
  "ger",
  "de",
  "area",
  "region",
  "greater",
  "metropolitan",
  "und",
  "umgebung",
  "umkreis",
  "bei",
  "near",
]);

/** German cities whose English/native spellings should collapse together
 *  (keys are post-normalization tokens; all map to the umlaut-expanded form). */
const CITY_ALIASES: Record<string, string> = {
  munich: "muenchen",
  munchen: "muenchen",
  cologne: "koeln",
  koln: "koeln",
  nuremberg: "nuernberg",
  nurnberg: "nuernberg",
  vienna: "wien",
};

const REMOTE_WORDS = [
  "remote",
  "homeoffice",
  "home office",
  "anywhere",
  "deutschlandweit",
  "germanywide",
  "germany wide",
];

/** Expand German umlauts/ß to ASCII digraphs BEFORE stripping accents, so
 *  "München" and "Muenchen" converge (NFKD alone would give "munchen"). */
function expandUmlauts(s: string): string {
  return s
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "ae")
    .replace(/Ö/g, "oe")
    .replace(/Ü/g, "ue")
    .replace(/ß/g, "ss");
}

/** Base text normalization: umlauts → digraphs, & → "and", lowercase, drop
 *  accents and punctuation, collapse whitespace. */
function base(s: string): string {
  return expandUmlauts(s)
    .toLowerCase()
    .replace(/&/g, " and ")
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip parenthesized + bare gender/diversity markers from a job title:
 *  (m/w/d), (all genders), (gn), bare "m/w/d", "w/m/x"… */
function stripGenderMarkers(s: string): string {
  return s
    .replace(/\((?:\s*(?:all genders?|gn|[dwmfx])\s*[/|]?\s*)+\)/gi, " ")
    .replace(/\b[mwfdx](?:\s*\/\s*[mwfdx]){1,3}\b/gi, " ");
}

export function normTitle(s: string): string {
  return base(stripGenderMarkers(s));
}

export function normCompany(s: string): string {
  const tokens = base(s).split(" ").filter(Boolean);
  // Strip trailing legal-form tokens, but never empty the name out.
  while (tokens.length > 1 && COMPANY_SUFFIX_TOKENS.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ");
}

export function normCity(location: string): string {
  // Cities come as "Berlin", "10115 Berlin", "Berlin, Germany", "Berlin Area"…
  const firstSegment = location.split(/[,;/·•|]/)[0] ?? location;
  const tokens = base(firstSegment)
    .split(" ")
    .filter((t) => t && !/^\d+$/.test(t) && !CITY_NOISE.has(t));
  const city = tokens.join(" ").trim();
  return CITY_ALIASES[city] ?? city;
}

export function isRemoteLocation(location: string): boolean {
  const b = base(location);
  return REMOTE_WORDS.some((w) => b.includes(w));
}

/** Two locations are compatible for de-dup when either is remote / unknown, or
 *  they name the same city. (A role posted as "Remote" on one board and
 *  "Berlin" on another is the same listing.) */
export function cityCompatible(a: string, b: string): boolean {
  if (isRemoteLocation(a) || isRemoteLocation(b)) return true;
  const ca = normCity(a);
  const cb = normCity(b);
  if (!ca || !cb) return true;
  return ca === cb;
}

/** Coarse blocking key — normalized company ONLY (not company+city), so the
 *  fuzzy matcher still gets to compare a "Remote" copy against a city copy of
 *  the same role at the same employer. */
export function companyBlockKey(company: string): string {
  return normCompany(company);
}
