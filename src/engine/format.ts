/** Format OKLCH as CSS `oklch()` functional notation.
 *  Achromatic colors clamp hue to 0 (powerless component per CSS Color 4). */
export function oklchToCss(
  l: number,
  c: number,
  h: number,
  alpha?: number,
): string {
  const lRounded = Math.round(l * 100 * 100) / 100
  const cRounded = Math.round(c * 100000) / 100000
  const hRounded = cRounded < 0.0002 ? 0 : Math.round(h * 100) / 100

  if (alpha != null) {
    const aRounded = Math.round(alpha * 10000) / 10000
    return `oklch(${lRounded}% ${cRounded} ${hRounded} / ${aRounded})`
  }
  return `oklch(${lRounded}% ${cRounded} ${hRounded})`
}
