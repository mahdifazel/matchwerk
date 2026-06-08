import { describe, expect, it } from "vitest";
import type { JobSourceId } from "@/generated/prisma/enums";
import { dedupeRawJobs } from "../dedupe";
import type { RawJob } from "../types";

function job(overrides: Partial<RawJob> & { source: JobSourceId }): RawJob {
  return {
    externalId: Math.random().toString(36).slice(2),
    title: "Product Designer",
    company: "Acme GmbH",
    location: "Berlin",
    url: "https://example.com",
    publisher: null,
    description: "",
    jobType: "FULL_TIME",
    seniority: "MID",
    publishedAt: null,
    ...overrides,
  };
}

describe("dedupeRawJobs", () => {
  it("collapses exact cross-source duplicates", () => {
    const out = dedupeRawJobs([
      job({ source: "BA_JOBBOERSE" }),
      job({ source: "JSEARCH" }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("keeps the highest-priority source's copy on collision", () => {
    const out = dedupeRawJobs([
      job({ source: "BA_JOBBOERSE", url: "ba" }),
      job({ source: "JSEARCH", url: "jsearch" }),
      job({ source: "ADZUNA", url: "adzuna" }),
    ]);
    expect(out).toHaveLength(1);
    // JSEARCH has the highest priority of the three.
    expect(out[0].source).toBe("JSEARCH");
    expect(out[0].url).toBe("jsearch");
  });

  it("is independent of input order (priority, not first-seen, wins)", () => {
    const a = dedupeRawJobs([
      job({ source: "JSEARCH" }),
      job({ source: "BA_JOBBOERSE" }),
    ]);
    const b = dedupeRawJobs([
      job({ source: "BA_JOBBOERSE" }),
      job({ source: "JSEARCH" }),
    ]);
    expect(a[0].source).toBe("JSEARCH");
    expect(b[0].source).toBe("JSEARCH");
  });

  it("ignores gender markers when matching titles", () => {
    const out = dedupeRawJobs([
      job({ source: "JSEARCH", title: "Product Designer (m/w/d)" }),
      job({ source: "ADZUNA", title: "Product Designer" }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("fuzzy-merges title variants at the same company and city", () => {
    const out = dedupeRawJobs([
      job({ source: "JSEARCH", title: "Senior Product Designer" }),
      job({
        source: "ADZUNA",
        title: "Senior Product Designer - parental leave cover",
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("JSEARCH");
  });

  it("does not merge different seniority levels", () => {
    const out = dedupeRawJobs([
      job({ source: "JSEARCH", title: "Junior Product Designer" }),
      job({ source: "JSEARCH", title: "Senior Product Designer" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("does not merge jobs at different companies", () => {
    const out = dedupeRawJobs([
      job({ source: "JSEARCH", company: "Acme GmbH" }),
      job({ source: "JSEARCH", company: "Globex AG" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("does not merge the same role in different cities", () => {
    const out = dedupeRawJobs([
      job({ source: "JSEARCH", location: "Berlin" }),
      job({ source: "JSEARCH", location: "Munich" }),
    ]);
    expect(out).toHaveLength(2);
  });
});
