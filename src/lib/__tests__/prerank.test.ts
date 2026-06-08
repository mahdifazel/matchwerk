import { describe, expect, it } from "vitest";
import type { JobSourceId } from "@/generated/prisma/enums";
import {
  lexicalScore,
  prerankAndCap,
  type PrerankJob,
  type PrerankPrefs,
} from "@/lib/prerank";

function job(overrides: Partial<PrerankJob> & { source: JobSourceId }): PrerankJob {
  return {
    title: "Product Designer",
    description: "",
    seniority: "MID",
    jobType: "FULL_TIME",
    publishedAt: null,
    ...overrides,
  };
}

const prefs: PrerankPrefs = {
  jobTitles: ["Product Designer", "UX Designer"],
  profileTerms: ["Figma", "design systems", "prototyping"],
  preferredSeniority: [],
  preferredJobTypes: [],
};

describe("lexicalScore", () => {
  it("ranks a title match above an unrelated role", () => {
    const match = lexicalScore(job({ source: "JSEARCH" }), prefs);
    const unrelated = lexicalScore(
      job({ source: "JSEARCH", title: "Warehouse Forklift Operator" }),
      prefs,
    );
    expect(match).toBeGreaterThan(unrelated);
  });

  it("rewards profile-term overlap in the description", () => {
    const withTerms = lexicalScore(
      job({ source: "JSEARCH", description: "You will use Figma and prototyping daily." }),
      prefs,
    );
    const without = lexicalScore(
      job({ source: "JSEARCH", description: "Some generic responsibilities." }),
      prefs,
    );
    expect(withTerms).toBeGreaterThan(without);
  });

  it("rewards a more recent posting", () => {
    const fresh = lexicalScore(job({ source: "JSEARCH", publishedAt: new Date() }), prefs);
    const old = lexicalScore(
      job({ source: "JSEARCH", publishedAt: new Date(Date.now() - 200 * 86_400_000) }),
      prefs,
    );
    expect(fresh).toBeGreaterThan(old);
  });

  it("gives a higher-priority source an edge, all else equal", () => {
    const jsearch = lexicalScore(job({ source: "JSEARCH" }), prefs);
    const jooble = lexicalScore(job({ source: "JOOBLE" }), prefs);
    expect(jsearch).toBeGreaterThan(jooble);
  });

  it("penalizes jobs that contradict seniority preferences", () => {
    const narrowed: PrerankPrefs = { ...prefs, preferredSeniority: ["SENIOR"] };
    const fit = lexicalScore(job({ source: "JSEARCH", seniority: "SENIOR" }), narrowed);
    const miss = lexicalScore(job({ source: "JSEARCH", seniority: "JUNIOR" }), narrowed);
    expect(fit).toBeGreaterThan(miss);
  });
});

describe("prerankAndCap", () => {
  it("returns at most `limit` jobs", () => {
    const jobs = Array.from({ length: 50 }, (_, i) =>
      job({ source: "JSEARCH", title: `Designer ${i}` }),
    );
    expect(prerankAndCap(jobs, prefs, 10)).toHaveLength(10);
  });

  it("keeps the strongest matches when capping", () => {
    const jobs = [
      job({ source: "JSEARCH", title: "Warehouse Forklift Operator" }),
      job({ source: "JSEARCH", title: "Product Designer" }),
      job({ source: "JSEARCH", title: "Truck Driver" }),
    ];
    const top = prerankAndCap(jobs, prefs, 1);
    expect(top).toHaveLength(1);
    expect(top[0].title).toBe("Product Designer");
  });

  it("breaks ties by source priority", () => {
    const jobs = [
      job({ source: "JOOBLE" }),
      job({ source: "JSEARCH" }),
    ];
    const out = prerankAndCap(jobs, prefs, 2);
    expect(out[0].source).toBe("JSEARCH");
  });

  it("returns all jobs (sorted) when under the limit", () => {
    const jobs = [
      job({ source: "JSEARCH", title: "Truck Driver" }),
      job({ source: "JSEARCH", title: "Product Designer" }),
    ];
    const out = prerankAndCap(jobs, prefs, 10);
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe("Product Designer");
  });

  it("does not let a high-volume source crowd out a high-priority one", () => {
    // 10 Adzuna + 2 JSearch, all equally relevant. A flat score sort could fill
    // every slot with Adzuna; the interleave must keep both JSearch jobs.
    const jobs = [
      ...Array.from({ length: 10 }, (_, i) =>
        job({ source: "ADZUNA", title: `Product Designer ${i}` }),
      ),
      job({ source: "JSEARCH", title: "Product Designer A" }),
      job({ source: "JSEARCH", title: "Product Designer B" }),
    ];
    const out = prerankAndCap(jobs, prefs, 4);
    expect(out).toHaveLength(4);
    expect(out.filter((j) => j.source === "JSEARCH")).toHaveLength(2);
    expect(out.filter((j) => j.source === "ADZUNA")).toHaveLength(2);
  });

  it("gives higher-priority sources more slots per round", () => {
    // Plenty of both; weights are JSearch=3, Adzuna=1, so a round fills 3:1.
    const jobs = [
      ...Array.from({ length: 20 }, (_, i) =>
        job({ source: "JSEARCH", title: `Product Designer ${i}` }),
      ),
      ...Array.from({ length: 20 }, (_, i) =>
        job({ source: "ADZUNA", title: `Product Designer ${i}` }),
      ),
    ];
    const out = prerankAndCap(jobs, prefs, 8);
    expect(out.filter((j) => j.source === "JSEARCH")).toHaveLength(6);
    expect(out.filter((j) => j.source === "ADZUNA")).toHaveLength(2);
  });
});
