import { describe, expect, it } from "vitest";
import { isBlockedPublisher } from "../blocklist";

describe("isBlockedPublisher", () => {
  it("blocks BeBee in any casing or domain form", () => {
    expect(isBlockedPublisher("BeBee")).toBe(true);
    expect(isBlockedPublisher("bebee")).toBe(true);
    expect(isBlockedPublisher("bebee.com")).toBe(true);
  });

  it("allows other publishers", () => {
    expect(isBlockedPublisher("LinkedIn")).toBe(false);
    expect(isBlockedPublisher("Indeed")).toBe(false);
    expect(isBlockedPublisher("Stepstone")).toBe(false);
  });

  it("treats missing publisher as allowed", () => {
    expect(isBlockedPublisher(null)).toBe(false);
    expect(isBlockedPublisher(undefined)).toBe(false);
    expect(isBlockedPublisher("")).toBe(false);
  });
});
