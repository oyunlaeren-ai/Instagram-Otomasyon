import { describe, expect, it } from "vitest";
import { parseCsvUsernames, sanitizeUsername } from "../src/shared/utils";

describe("csv import", () => {
  it("imports unique usernames and skips formulas", () => {
    const csv = "username\nuser1\nuser1\n=cmd\nuser2\n";
    expect(parseCsvUsernames(csv)).toEqual(["user1", "user2"]);
  });

  it("rejects invalid usernames", () => {
    expect(sanitizeUsername("=HYPERLINK")).toBeNull();
    expect(sanitizeUsername("ok_user")).toBe("ok_user");
  });
});
