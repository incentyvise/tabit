import { describe, expect, test } from "vitest";
import { safeInternalPath } from "./navigation";

describe("safeInternalPath", () => {
  test("keeps in-app paths with query and hash", () => {
    expect(safeInternalPath("/tabs/abc?edit=1#x", "/tabs")).toBe("/tabs/abc?edit=1#x");
  });

  test.each([
    "https://evil.example/?x",
    "//evil.example/path",
    "/\\evil.example",
    "/\\/evil.example",
    "javascript:alert(1)",
    "tabs",
    "",
    null,
    undefined,
  ])("rejects %s", (value) => {
    expect(safeInternalPath(value, "/tabs")).toBe("/tabs");
  });
});
