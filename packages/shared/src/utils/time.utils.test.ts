import { describe, it, expect, vi, afterEach } from "vitest";
import {
  nowUtcMs,
  nowUtcIso,
  msToSeconds,
  secondsToMs,
  isExpired,
  addMinutes,
} from "./time.utils.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("nowUtcMs", () => {
  it("returns a positive integer close to Date.now()", () => {
    const before = Date.now();
    const result = nowUtcMs();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it("returns a different value on successive calls (time advances)", async () => {
    const a = nowUtcMs();
    await new Promise((r) => setTimeout(r, 2));
    const b = nowUtcMs();
    expect(b).toBeGreaterThan(a);
  });
});

describe("nowUtcIso", () => {
  it("returns a valid ISO 8601 string", () => {
    const iso = nowUtcIso();
    expect(() => new Date(iso)).not.toThrow();
    expect(new Date(iso).toISOString()).toBe(iso);
  });

  it("uses fake timer correctly", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00.000Z"));
    expect(nowUtcIso()).toBe("2024-01-15T12:00:00.000Z");
  });
});

describe("msToSeconds", () => {
  it("converts 1000 ms to 1 second", () => {
    expect(msToSeconds(1000)).toBe(1);
  });

  it("floors fractional seconds", () => {
    expect(msToSeconds(1500)).toBe(1);
    expect(msToSeconds(1999)).toBe(1);
  });

  it("converts 0 ms to 0 seconds", () => {
    expect(msToSeconds(0)).toBe(0);
  });

  it("converts 60000 ms to 60 seconds", () => {
    expect(msToSeconds(60_000)).toBe(60);
  });
});

describe("secondsToMs", () => {
  it("converts 1 second to 1000 ms", () => {
    expect(secondsToMs(1)).toBe(1000);
  });

  it("converts 0 seconds to 0 ms", () => {
    expect(secondsToMs(0)).toBe(0);
  });

  it("converts 60 seconds to 60000 ms", () => {
    expect(secondsToMs(60)).toBe(60_000);
  });

  it("is the inverse of msToSeconds for whole seconds", () => {
    for (const s of [1, 5, 30, 120, 3600]) {
      expect(msToSeconds(secondsToMs(s))).toBe(s);
    }
  });
});

describe("isExpired", () => {
  it("returns false for a future timestamp", () => {
    const future = Date.now() + 60_000;
    expect(isExpired(future)).toBe(false);
  });

  it("returns true for a past timestamp", () => {
    const past = Date.now() - 1;
    expect(isExpired(past)).toBe(true);
  });

  it("uses fake timer correctly", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(isExpired(999_999)).toBe(true);
    expect(isExpired(1_000_001)).toBe(false);
  });
});

describe("addMinutes", () => {
  it("adds 5 minutes to a base time", () => {
    const base = 1_000_000;
    expect(addMinutes(base, 5)).toBe(base + 5 * 60 * 1000);
  });

  it("adds 0 minutes — returns base unchanged", () => {
    const base = 9_999_999;
    expect(addMinutes(base, 0)).toBe(base);
  });

  it("works with negative minutes (subtracts time)", () => {
    const base = 600_000;
    expect(addMinutes(base, -5)).toBe(base - 5 * 60 * 1000);
  });
});
