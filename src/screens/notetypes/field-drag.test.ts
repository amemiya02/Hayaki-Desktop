import { describe, expect, it } from "vitest";

import { reorderTarget } from "./field-drag";

describe("reorderTarget", () => {
  it("is null where the drop leaves the field in place", () => {
    expect(reorderTarget(2, 2, "before")).toBeNull();
    expect(reorderTarget(2, 2, "after")).toBeNull();
    expect(reorderTarget(2, 1, "after")).toBeNull();
    expect(reorderTarget(2, 3, "before")).toBeNull();
  });
  it("moves a field up to before a row", () => {
    expect(reorderTarget(3, 0, "before")).toBe(0);
    expect(reorderTarget(3, 1, "after")).toBe(2);
  });
  it("moves a field down to after a row", () => {
    expect(reorderTarget(0, 2, "after")).toBe(2);
    expect(reorderTarget(0, 3, "before")).toBe(2);
  });
});
