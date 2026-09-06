import { describe, expect, test } from "bun:test";
import { TECHNOLOGY_LIBRARY, technologyIcons } from "./technologyIcons";

describe("technology badge library", () => {
  test("keeps a compact catalogue of locally available brand icons", () => {
    expect(TECHNOLOGY_LIBRARY).toHaveLength(52);
    expect(new Set(TECHNOLOGY_LIBRARY).size).toBe(52);
    expect(TECHNOLOGY_LIBRARY).toContain("Stripe");
    expect(TECHNOLOGY_LIBRARY).toContain("PayPal");

    for (const technology of TECHNOLOGY_LIBRARY) {
      expect(technologyIcons(technology), technology).not.toHaveLength(0);
    }
  });
});
