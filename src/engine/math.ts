/** Pre-computed sRGB gamma-decode table for all 256 8-bit values. */
const GAMMA_LUT = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255.0
  GAMMA_LUT[i] =
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Combined W3C matrix: Linear sRGB → LMS (folded XYZ step). */
const SRGB_TO_LMS = [
  [0.41222147, 0.53633255, 0.05144599],
  [0.21190350, 0.68069953, 0.10739695],
  [0.08830246, 0.28171885, 0.62997872],
]

/** W3C matrix: LMS (cube-root) → OKLab. */
const LMS_TO_OKLAB = [
  [0.2104542553, 0.7936177850, -0.0040720468],
  [1.9779984951, -2.4285922050, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.8086757660],
]

/** Convert an 8-bit sRGB channel to linear light via LUT. */
function srgb8ToLinear(v: number): number {
  return GAMMA_LUT[v]
}

/** Convert float gamma-encoded sRGB (0.0–1.0) to linear light. */
function srgbGammaToLinear(c: number): number {
  const absC = Math.abs(c)
  const linear =
    absC <= 0.04045
      ? absC / 12.92
      : Math.pow((absC + 0.055) / 1.055, 2.4)
  return Math.sign(c) * linear
}

/** Linear sRGB (0.0–1.0 per channel) → OKLCH. */
export function linearRgbToOklch(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  // sRGB → LMS
  const l =
    SRGB_TO_LMS[0][0] * r + SRGB_TO_LMS[0][1] * g + SRGB_TO_LMS[0][2] * b
  const m =
    SRGB_TO_LMS[1][0] * r + SRGB_TO_LMS[1][1] * g + SRGB_TO_LMS[1][2] * b
  const s =
    SRGB_TO_LMS[2][0] * r + SRGB_TO_LMS[2][1] * g + SRGB_TO_LMS[2][2] * b

  // Cube root (signed)
  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)

  // LMS → OKLab
  const labL =
    LMS_TO_OKLAB[0][0] * l_ + LMS_TO_OKLAB[0][1] * m_ + LMS_TO_OKLAB[0][2] * s_
  const labA =
    LMS_TO_OKLAB[1][0] * l_ + LMS_TO_OKLAB[1][1] * m_ + LMS_TO_OKLAB[1][2] * s_
  const labB =
    LMS_TO_OKLAB[2][0] * l_ + LMS_TO_OKLAB[2][1] * m_ + LMS_TO_OKLAB[2][2] * s_

  // OKLab → OKLCH
  const c = Math.sqrt(labA * labA + labB * labB)
  let h = 0
  if (c >= 1e-6) {
    h = Math.atan2(labB, labA) * (180 / Math.PI)
    if (h < 0) h += 360
  }

  return [labL, c, h]
}

/** Convert 8-bit sRGB → OKLCH (fast path via LUT). */
export function srgb8ToOklch(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  return linearRgbToOklch(srgb8ToLinear(r), srgb8ToLinear(g), srgb8ToLinear(b))
}

/** Convert float gamma-encoded sRGB (0.0–1.0) → OKLCH (uncached, high precision). */
export function srgbFloatToOklch(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  return linearRgbToOklch(
    srgbGammaToLinear(r),
    srgbGammaToLinear(g),
    srgbGammaToLinear(b),
  )
}

// ─── HSL → sRGB (CSS Color 4 algorithm) ───

export function hslToSrgb(
  h: number,
  s: number,
  l: number,
): [number, number, number] {
  const hue = ((h % 360) + 360) % 360
  const sat = Math.max(0, Math.min(100, s)) / 100
  const light = Math.max(0, Math.min(100, l)) / 100

  const c = (1 - Math.abs(2 * light - 1)) * sat
  const hPrime = hue / 60
  const x = c * (1 - Math.abs((hPrime % 2) - 1))
  const m = light - c / 2

  let r1: number, g1: number, b1: number
  if (hPrime < 1) [r1, g1, b1] = [c, x, 0]
  else if (hPrime < 2) [r1, g1, b1] = [x, c, 0]
  else if (hPrime < 3) [r1, g1, b1] = [0, c, x]
  else if (hPrime < 4) [r1, g1, b1] = [0, x, c]
  else if (hPrime < 5) [r1, g1, b1] = [x, 0, c]
  else [r1, g1, b1] = [c, 0, x]

  return [r1 + m, g1 + m, b1 + m]
}

// ─── HWB → sRGB (CSS Color 4 algorithm) ───

export function hwbToSrgb(
  h: number,
  w: number,
  b: number,
): [number, number, number] {
  const hue = ((h % 360) + 360) % 360
  const white = Math.max(0, Math.min(100, w)) / 100
  const black = Math.max(0, Math.min(100, b)) / 100

  if (white + black >= 1) {
    const gray = white / (white + black)
    return [gray, gray, gray]
  }

  const [r, g, b_] = hslToSrgb(hue, 100, 50)
  const r2 = r * (1 - white) + white
  const g2 = g * (1 - white) + white
  const b2 = b_ * (1 - white) + white

  return [r2 * (1 - black), g2 * (1 - black), b2 * (1 - black)]
}
