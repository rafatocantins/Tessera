export function nowUtcMs(): number {
  return Date.now();
}

export function nowUtcIso(): string {
  return new Date().toISOString();
}

export function msToSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

export function secondsToMs(s: number): number {
  return s * 1000;
}

export function isExpired(expiresAtMs: number): boolean {
  return Date.now() > expiresAtMs;
}

export function addMinutes(baseMs: number, minutes: number): number {
  return baseMs + minutes * 60 * 1000;
}
