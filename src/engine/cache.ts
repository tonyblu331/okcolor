const CACHE_SLOTS = 4096
const CACHE_MASK = CACHE_SLOTS - 1

const keys = new Uint32Array(CACHE_SLOTS)
const vals = new Float64Array(CACHE_SLOTS * 3)

/** Pack (r, g, b, a8) into a single u32 key. */
function packKey(r: number, g: number, b: number, a: number): number {
  return ((r | (g << 8) | (b << 16) | (a << 24)) >>> 0)
}

/** Lookup a cached OKLCH value. Returns null on miss. */
export function cacheGet(
  r: number,
  g: number,
  b: number,
  alpha?: number,
): [number, number, number] | null {
  const a8 = alpha != null ? Math.round(alpha * 255) : 255
  const key = packKey(r, g, b, a8)
  const idx = key & CACHE_MASK
  if (keys[idx] === key) {
    const base = idx * 3
    return [vals[base], vals[base + 1], vals[base + 2]]
  }
  return null
}

/** Store an OKLCH value in the cache. */
export function cacheSet(
  r: number,
  g: number,
  b: number,
  alpha: number | undefined,
  oklch: [number, number, number],
): void {
  const a8 = alpha != null ? Math.round(alpha * 255) : 255
  const key = packKey(r, g, b, a8)
  const idx = key & CACHE_MASK
  keys[idx] = key
  const base = idx * 3
  vals[base] = oklch[0]
  vals[base + 1] = oklch[1]
  vals[base + 2] = oklch[2]
}
