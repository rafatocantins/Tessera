import { describe, it, expect } from "vitest";
import { estimateCostUsd, formatCostUsd } from "./cost.utils.js";

describe("estimateCostUsd", () => {
  it("returns 0 for 0 tokens", () => {
    expect(estimateCostUsd("gpt-4o", 0, 0)).toBe(0);
  });

  it("calculates cost for gpt-4o correctly", () => {
    // gpt-4o: $2.5/M input, $10/M output
    const cost = estimateCostUsd("gpt-4o", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(12.5, 6);
  });

  it("calculates cost for claude-3-5-haiku correctly", () => {
    // haiku: $0.8/M input, $4.0/M output
    const cost = estimateCostUsd("claude-3-5-haiku-20241022", 100_000, 50_000);
    expect(cost).toBeCloseTo(0.08 + 0.2, 6); // 0.08 input + 0.2 output = 0.28
  });

  it("calculates cost for gemini-2.0-flash correctly", () => {
    // gemini-2.0-flash: $0.075/M input, $0.3/M output
    const cost = estimateCostUsd("gemini-2.0-flash", 2_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.075 * 2 + 0.3, 6);
  });

  it("uses conservative default rate for unknown model", () => {
    // Default: $3.0/M input, $15.0/M output
    const cost = estimateCostUsd("unknown-model-xyz", 1_000_000, 0);
    expect(cost).toBeCloseTo(3.0, 6);
  });

  it("uses different rates for input vs output tokens", () => {
    // gpt-4o: input cheaper than output
    const inputOnly = estimateCostUsd("gpt-4o", 1_000_000, 0);
    const outputOnly = estimateCostUsd("gpt-4o", 0, 1_000_000);
    expect(outputOnly).toBeGreaterThan(inputOnly);
  });

  it("is linear in token count", () => {
    const single = estimateCostUsd("gpt-4o-mini", 1000, 1000);
    const double = estimateCostUsd("gpt-4o-mini", 2000, 2000);
    expect(double).toBeCloseTo(single * 2, 10);
  });

  it("returns 0 for any model when tokens are both 0", () => {
    const models = ["gpt-4o", "claude-3-opus-20240229", "gemini-1.5-pro", "some-unknown-model"];
    for (const model of models) {
      expect(estimateCostUsd(model, 0, 0)).toBe(0);
    }
  });
});

describe("formatCostUsd", () => {
  it("formats values >= $0.001 with 4 decimal places", () => {
    expect(formatCostUsd(0.001)).toBe("$0.0010");
    expect(formatCostUsd(1.5)).toBe("$1.5000");
    expect(formatCostUsd(10.0)).toBe("$10.0000");
    expect(formatCostUsd(0.1234)).toBe("$0.1234");
  });

  it("formats very small values (< $0.001) in milli-dollars with 3 decimal places", () => {
    expect(formatCostUsd(0.0001)).toBe("$0.100m");
    expect(formatCostUsd(0.0005)).toBe("$0.500m");
    expect(formatCostUsd(0.00099)).toBe("$0.990m");
  });

  it("formats $0 correctly", () => {
    expect(formatCostUsd(0)).toBe("$0.000m");
  });

  it("correctly handles the boundary at $0.001", () => {
    // Exactly at boundary: 0.001 * 1000 = 1, which is not < 0.001 → regular format
    expect(formatCostUsd(0.001)).not.toContain("m");
    expect(formatCostUsd(0.0009)).toContain("m");
  });
});
