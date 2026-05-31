use crate::cache;
use std::sync::LazyLock;

// ── sRGB gamma decode LUT (once, at runtime) ──────────────────────────
// Can't be const because powf is not const-evaluable.
static GAMMA_LUT: LazyLock<[f64; 256]> = LazyLock::new(|| {
    let mut lut = [0.0f64; 256];
    for (i, v) in lut.iter_mut().enumerate() {
        let c = i as f64 / 255.0;
        *v = if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        };
    }
    lut
});

// ── OKLab matrices (per Ottosson 2020, CSS Color 4) ───────────────────
// Folded: linear sRGB → LMS (combines sRGB→XYZ→LMS in one multiply).

const SRGB_TO_LMS: [[f64; 3]; 3] = [
    [0.4122214708, 0.5363325363, 0.0514459929],
    [0.2119034982, 0.6806995451, 0.1073969566],
    [0.0883024619, 0.2817188376, 0.6299787005],
];

const LMS_TO_OKLAB: [[f64; 3]; 3] = [
    [0.2104542553, 0.7936177850, -0.0040720468],
    [1.9779984951, -2.4285922050, 0.4505937099],
    [0.0259040371, 0.7827717662, -0.8086757660],
];

// ── Private helpers ────────────────────────────────────────────────────

fn srgb8_to_linear(v: u8) -> f64 {
    GAMMA_LUT[v as usize]
}

/// Gamma-decode a single float sRGB channel (may be negative, out of band).
fn srgb_gamma_to_linear(c: f64) -> f64 {
    let abs_c = c.abs();
    let linear = if abs_c <= 0.04045 {
        abs_c / 12.92
    } else {
        ((abs_c + 0.055) / 1.055).powf(2.4)
    };
    c.signum() * linear
}

/// Core transform: linear sRGB → OKLCH.
fn linear_rgb_to_oklch(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    // sRGB → LMS
    let l = SRGB_TO_LMS[0][0] * r + SRGB_TO_LMS[0][1] * g + SRGB_TO_LMS[0][2] * b;
    let m = SRGB_TO_LMS[1][0] * r + SRGB_TO_LMS[1][1] * g + SRGB_TO_LMS[1][2] * b;
    let s = SRGB_TO_LMS[2][0] * r + SRGB_TO_LMS[2][1] * g + SRGB_TO_LMS[2][2] * b;

    // Cube root (signed — correct for out-of-gamut negative values)
    let l_ = l.cbrt();
    let m_ = m.cbrt();
    let s_ = s.cbrt();

    // LMS_cuberoot → OKLab
    let lab_l = LMS_TO_OKLAB[0][0] * l_ + LMS_TO_OKLAB[0][1] * m_ + LMS_TO_OKLAB[0][2] * s_;
    let lab_a = LMS_TO_OKLAB[1][0] * l_ + LMS_TO_OKLAB[1][1] * m_ + LMS_TO_OKLAB[1][2] * s_;
    let lab_b = LMS_TO_OKLAB[2][0] * l_ + LMS_TO_OKLAB[2][1] * m_ + LMS_TO_OKLAB[2][2] * s_;

    // OKLab → OKLCH
    let c = (lab_a * lab_a + lab_b * lab_b).sqrt();
    let h = if c >= 1e-6 {
        let h = lab_b.atan2(lab_a).to_degrees();
        if h < 0.0 { h + 360.0 } else { h }
    } else {
        0.0
    };

    (lab_l, c, h)
}

// ── Public API ─────────────────────────────────────────────────────────

/// Fast path: 8-bit sRGB channels → OKLCH via pre-computed gamma LUT.
pub fn srgb8_to_oklch(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
    linear_rgb_to_oklch(srgb8_to_linear(r), srgb8_to_linear(g), srgb8_to_linear(b))
}

/// Float sRGB (gamma-encoded, 0.0–1.0 range) → OKLCH.
/// Used by HSL/HWB/color(srgb) paths where precision matters.
pub fn srgb_float_to_oklch(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    linear_rgb_to_oklch(
        srgb_gamma_to_linear(r),
        srgb_gamma_to_linear(g),
        srgb_gamma_to_linear(b),
    )
}

/// Convert gamma-encoded sRGB float (RawColor channels) to OKLCH.
///
/// Uses a LUT + cache for 8-bit-precision values, and the full powf path
/// for float values (HSL/HWB intermediates, color() function, etc.).
///
/// Returns `(l, c, h, alpha)` where `alpha` is passed through unchanged.
pub fn raw_to_oklch(r: f64, g: f64, b: f64, alpha: Option<f64>) -> (f64, f64, f64, Option<f64>) {
    // Check if values round-trip to u8 exactly (the common case for hex/rgb/named)
    let ri = (r * 255.0).round() as u8;
    let gi = (g * 255.0).round() as u8;
    let bi = (b * 255.0).round() as u8;
    let is_exact_u8 = (ri as f64 - r * 255.0).abs() < 1e-6
        && (gi as f64 - g * 255.0).abs() < 1e-6
        && (bi as f64 - b * 255.0).abs() < 1e-6;

    if is_exact_u8 {
        let a8 = alpha.map(|a| (a * 255.0).round() as u8).unwrap_or(255);
        if let Some((l, c, h)) = cache::cache_get(ri, gi, bi, a8) {
            return (l, c, h, alpha);
        }
        let (l, c, h) = srgb8_to_oklch(ri, gi, bi);
        cache::cache_set(ri, gi, bi, a8, (l, c, h));
        (l, c, h, alpha)
    } else {
        let (l, c, h) = srgb_float_to_oklch(r, g, b);
        (l, c, h, alpha)
    }
}

// ── HSL → sRGB  (CSS Color 4, §7.2.4) ─────────────────────────────────

pub fn hsl_to_srgb(h: f64, s: f64, l: f64) -> (f64, f64, f64) {
    let hue = ((h % 360.0) + 360.0) % 360.0;
    let sat = (s.clamp(0.0, 100.0)) / 100.0;
    let light = (l.clamp(0.0, 100.0)) / 100.0;

    let c = (1.0 - (2.0 * light - 1.0).abs()) * sat;
    let h_prime = hue / 60.0;
    let x = c * (1.0 - ((h_prime % 2.0) - 1.0).abs());
    let m = light - c / 2.0;

    let (r1, g1, b1) = match h_prime {
        hp if hp < 1.0 => (c, x, 0.0),
        hp if hp < 2.0 => (x, c, 0.0),
        hp if hp < 3.0 => (0.0, c, x),
        hp if hp < 4.0 => (0.0, x, c),
        hp if hp < 5.0 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };

    (r1 + m, g1 + m, b1 + m)
}

// ── HWB → sRGB  (CSS Color 4, §7.3.3) ─────────────────────────────────

pub fn hwb_to_srgb(h: f64, w: f64, b: f64) -> (f64, f64, f64) {
    let hue = ((h % 360.0) + 360.0) % 360.0;
    let white = (w.clamp(0.0, 100.0)) / 100.0;
    let black = (b.clamp(0.0, 100.0)) / 100.0;

    if white + black >= 1.0 {
        let gray = white / (white + black);
        return (gray, gray, gray);
    }

    let (r, g, b_) = hsl_to_srgb(hue, 100.0, 50.0);
    let factor = 1.0 - white - black;

    (r * factor + white, g * factor + white, b_ * factor + white)
}

// ── sRGB gamma encode ──────────────────────────────────────────────────

/// Gamma-encode a linear sRGB channel (inverse of `srgb_gamma_to_linear`).
fn srgb_linear_to_gamma(c: f64) -> f64 {
    let abs_c = c.abs();
    let gamma = if abs_c <= 0.0031308 {
        abs_c * 12.92
    } else {
        1.055 * abs_c.powf(1.0 / 2.4) - 0.055
    };
    c.signum() * gamma
}

// ── OKLCH → sRGB (inverse of linear_rgb_to_oklch) ─────────────────────

/// OKLab → linear sRGB (inverse of LMS_TO_OKLAB × cube root × SRGB_TO_LMS).
pub fn oklab_to_linear_srgb(l: f64, a: f64, b: f64) -> (f64, f64, f64) {
    // OKLab → LMS cuberoot (inverse of LMS_TO_OKLAB)
    let l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    let m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    let s_ = l - 0.0894841775 * a - 1.2914855480 * b;

    // Cube (inverse of cube root)
    let l = l_ * l_ * l_;
    let m = m_ * m_ * m_;
    let s = s_ * s_ * s_;

    // LMS → sRGB linear (inverse of SRGB_TO_LMS)
    (
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    )
}

/// OKLCH → sRGB (gamma-encoded, 0.0–1.0 range).
pub fn oklch_to_srgb(l: f64, c: f64, h: f64) -> (f64, f64, f64) {
    let h_rad = h.to_radians();
    let a = c * h_rad.cos();
    let b_ = c * h_rad.sin();

    let (rl, gl, bl) = oklab_to_linear_srgb(l, a, b_);
    (
        (srgb_linear_to_gamma(rl).clamp(0.0, 1.0)),
        (srgb_linear_to_gamma(gl).clamp(0.0, 1.0)),
        (srgb_linear_to_gamma(bl).clamp(0.0, 1.0)),
    )
}

// ── sRGB → HSL (CSS Color 4, §7.2.4 inverse) ───────────────────────────

/// sRGB (gamma-encoded, 0.0–1.0) → HSL (h: 0–360, s: 0–100, l: 0–100).
pub fn srgb_to_hsl(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let range = max - min;

    let l = (max + min) / 2.0;

    if range < 1e-8 {
        return (0.0, 0.0, l * 100.0);
    }

    let s = if l <= 0.5 {
        range / (max + min)
    } else {
        range / (2.0 - max - min)
    };

    let h = if max == r {
        ((g - b) / range + if g < b { 6.0 } else { 0.0 }) * 60.0
    } else if max == g {
        ((b - r) / range + 2.0) * 60.0
    } else {
        ((r - g) / range + 4.0) * 60.0
    };

    (h, s * 100.0, l * 100.0)
}

// ── sRGB → HWB (CSS Color 4, §7.3.3 inverse) ───────────────────────────

/// sRGB (gamma-encoded, 0.0–1.0) → HWB (h: 0–360, w: 0–100, b: 0–100).
pub fn srgb_to_hwb(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    let (h, _, _) = srgb_to_hsl(r, g, b);
    let w = r.min(g).min(b) * 100.0;
    let b_ = (1.0 - r.max(g).max(b)) * 100.0;
    (h, w, b_)
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // ── OKLCH round-trip sanity ──

    #[test]
    fn test_black_is_achromatic() {
        let (l, c, h) = srgb8_to_oklch(0, 0, 0);
        approx(l, 0.0);
        approx(c, 0.0);
        approx(h, 0.0);
    }

    #[test]
    fn test_white_is_achromatic() {
        let (l, c, h) = srgb8_to_oklch(255, 255, 255);
        approx(l, 1.0);
        approx(c, 0.0);
        approx(h, 0.0);
    }

    #[test]
    fn test_mid_gray_is_achromatic() {
        let (_, c, h) = srgb8_to_oklch(128, 128, 128);
        assert!(c < 1e-6);
        approx(h, 0.0);
    }

    #[test]
    fn test_red_value() {
        let (l, c, h) = srgb8_to_oklch(255, 0, 0);
        approx_delta(l, 0.62796, 1e-4);
        approx_delta(c, 0.25768, 1e-4);
        approx_delta(h, 29.2339, 1e-2);
    }

    #[test]
    fn test_green_value() {
        let (l, c, h) = srgb8_to_oklch(0, 255, 0);
        approx_delta(l, 0.86644, 1e-4);
        approx_delta(c, 0.29483, 1e-4);
        approx_delta(h, 142.495, 1e-2);
    }

    #[test]
    fn test_blue_value() {
        let (l, c, h) = srgb8_to_oklch(0, 0, 255);
        approx_delta(l, 0.45201, 1e-4);
        approx_delta(c, 0.31321, 1e-4);
        approx_delta(h, 264.053, 1e-2);
    }

    #[test]
    fn test_srgb_float_black() {
        let (l, c, h) = srgb_float_to_oklch(0.0, 0.0, 0.0);
        approx(l, 0.0);
        approx(c, 0.0);
        approx(h, 0.0);
    }

    #[test]
    fn test_srgb_float_white() {
        let (l, _, _) = srgb_float_to_oklch(1.0, 1.0, 1.0);
        approx_delta(l, 1.0, 1e-4);
    }

    #[test]
    fn test_negative_channel_does_not_panic() {
        // Out-of-gamut values should still compute (signed cube root)
        let (_, _, h) = srgb_float_to_oklch(-0.5, 0.0, 0.0);
        assert!(h.is_finite());
    }

    // ── HSL → sRGB ──

    #[test]
    fn test_hsl_red() {
        let (r, g, b) = hsl_to_srgb(0.0, 100.0, 50.0);
        approx_delta(r, 1.0, 1e-4);
        approx(g, 0.0);
        approx(b, 0.0);
    }

    #[test]
    fn test_hsl_white() {
        let (r, g, b) = hsl_to_srgb(0.0, 0.0, 100.0);
        approx_delta(r, 1.0, 1e-4);
        approx_delta(g, 1.0, 1e-4);
        approx_delta(b, 1.0, 1e-4);
    }

    #[test]
    fn test_hsl_gray() {
        let (r, g, b) = hsl_to_srgb(0.0, 0.0, 50.0);
        approx_delta(r, 0.5, 1e-4);
        approx_delta(g, 0.5, 1e-4);
        approx_delta(b, 0.5, 1e-4);
    }

    #[test]
    fn test_hsl_blue() {
        let (r, g, b) = hsl_to_srgb(240.0, 100.0, 50.0);
        approx(r, 0.0);
        approx(g, 0.0);
        approx_delta(b, 1.0, 1e-4);
    }

    #[test]
    fn test_hsl_wraps_negative_hue() {
        let (r, g, b) = hsl_to_srgb(-120.0, 100.0, 50.0);
        // -120° = 240° → blue
        approx(r, 0.0);
        approx(g, 0.0);
        approx_delta(b, 1.0, 1e-4);
    }

    // ── HWB → sRGB ──

    #[test]
    fn test_hwb_red() {
        let (r, g, b) = hwb_to_srgb(0.0, 0.0, 0.0);
        approx_delta(r, 1.0, 1e-4);
        approx(g, 0.0);
        approx(b, 0.0);
    }

    #[test]
    fn test_hwb_white() {
        let (r, g, b) = hwb_to_srgb(0.0, 100.0, 0.0);
        approx_delta(r, 1.0, 1e-4);
        approx_delta(g, 1.0, 1e-4);
        approx_delta(b, 1.0, 1e-4);
    }

    #[test]
    fn test_hwb_black() {
        let (r, g, b) = hwb_to_srgb(0.0, 0.0, 100.0);
        approx(r, 0.0);
        approx(g, 0.0);
        approx(b, 0.0);
    }

    #[test]
    fn test_hwb_w_and_b_sum_to_100() {
        let (r, g, b) = hwb_to_srgb(0.0, 50.0, 50.0);
        // white+black >= 1 → gray = 0.5/1 = 0.5
        approx_delta(r, 0.5, 1e-4);
        approx_delta(g, 0.5, 1e-4);
        approx_delta(b, 0.5, 1e-4);
    }

    #[test]
    fn test_hwb_with_white_and_black_uses_css_mix_formula() {
        let (r, g, b) = hwb_to_srgb(0.0, 20.0, 30.0);
        // CSS Color 4: rgb = hue_rgb * (1 - white - black) + white
        approx_delta(r, 0.7, 1e-4);
        approx_delta(g, 0.2, 1e-4);
        approx_delta(b, 0.2, 1e-4);
    }

    // ── OKLCH ↔ sRGB roundtrip ──

    #[test]
    fn test_oklch_red_roundtrip() {
        let (l, c, h) = srgb8_to_oklch(255, 0, 0);
        let (r, g, b) = oklch_to_srgb(l, c, h);
        approx_delta(r, 1.0, 2e-3);
        approx(g, 0.0);
        approx(b, 0.0);
    }

    #[test]
    fn test_oklch_green_roundtrip() {
        let (l, c, h) = srgb8_to_oklch(0, 255, 0);
        let (r, g, b) = oklch_to_srgb(l, c, h);
        approx(r, 0.0);
        approx_delta(g, 1.0, 2e-3);
        approx(b, 0.0);
    }

    #[test]
    fn test_oklch_blue_roundtrip() {
        let (l, c, h) = srgb8_to_oklch(0, 0, 255);
        let (r, g, b) = oklch_to_srgb(l, c, h);
        approx(r, 0.0);
        approx(g, 0.0);
        approx_delta(b, 1.0, 2e-3);
    }

    #[test]
    fn test_oklch_white_roundtrip() {
        let (l, c, h) = srgb8_to_oklch(255, 255, 255);
        let (r, g, b) = oklch_to_srgb(l, c, h);
        approx_delta(r, 1.0, 2e-3);
        approx_delta(g, 1.0, 2e-3);
        approx_delta(b, 1.0, 2e-3);
    }

    #[test]
    fn test_oklch_black_roundtrip() {
        let (l, c, h) = srgb8_to_oklch(0, 0, 0);
        let (r, g, b) = oklch_to_srgb(l, c, h);
        approx(r, 0.0);
        approx(g, 0.0);
        approx(b, 0.0);
    }

    #[test]
    fn test_oklch_gray50_roundtrip() {
        let (l, c, h) = srgb8_to_oklch(128, 128, 128);
        let (r, g, b) = oklch_to_srgb(l, c, h);
        approx_delta(r, 0.5, 2e-3);
        approx_delta(g, 0.5, 2e-3);
        approx_delta(b, 0.5, 2e-3);
    }

    // ── HSL ↔ sRGB roundtrip ──

    #[test]
    fn test_hsl_red_roundtrip() {
        let (r, g, b) = hsl_to_srgb(0.0, 100.0, 50.0);
        let (h, s, l) = srgb_to_hsl(r, g, b);
        approx_delta(h, 0.0, 1e-4);
        approx_delta(s, 100.0, 1e-4);
        approx_delta(l, 50.0, 1e-4);
    }

    #[test]
    fn test_hsl_blue_roundtrip() {
        let (r, g, b) = hsl_to_srgb(240.0, 100.0, 50.0);
        let (h, s, l) = srgb_to_hsl(r, g, b);
        approx_delta(h, 240.0, 1e-4);
        approx_delta(s, 100.0, 1e-4);
        approx_delta(l, 50.0, 1e-4);
    }

    #[test]
    fn test_hsl_white_roundtrip() {
        let (r, g, b) = hsl_to_srgb(120.0, 50.0, 100.0);
        let (h, s, l) = srgb_to_hsl(r, g, b);
        // Gray has h=0, s=0
        approx_delta(h, 0.0, 1e-4);
        approx(s, 0.0);
        approx_delta(l, 100.0, 1e-4);
    }

    #[test]
    fn test_hsl_gray_roundtrip() {
        let (r, g, b) = hsl_to_srgb(0.0, 0.0, 50.0);
        let (h, s, l) = srgb_to_hsl(r, g, b);
        approx_delta(h, 0.0, 1e-4);
        approx(s, 0.0);
        approx_delta(l, 50.0, 1e-4);
    }

    // ── HWB ↔ sRGB roundtrip ──

    #[test]
    fn test_hwb_red_roundtrip() {
        let (r, g, b) = hwb_to_srgb(0.0, 0.0, 0.0);
        let (h, w, b_) = srgb_to_hwb(r, g, b);
        approx_delta(h, 0.0, 1e-4);
        approx(w, 0.0);
        approx(b_, 0.0);
    }

    #[test]
    fn test_hwb_white_roundtrip() {
        let (r, g, b) = hwb_to_srgb(0.0, 100.0, 0.0);
        let (h, w, b_) = srgb_to_hwb(r, g, b);
        approx_delta(h, 0.0, 1e-4);
        approx_delta(w, 100.0, 1e-4);
        approx(b_, 0.0);
    }

    proptest! {
        #[test]
        fn prop_srgb8_oklch_roundtrips_within_tolerance(r in any::<u8>(), g in any::<u8>(), b in any::<u8>()) {
            let (l, c, h) = srgb8_to_oklch(r, g, b);
            let (actual_r, actual_g, actual_b) = oklch_to_srgb(l, c, h);

            prop_assert!((actual_r - f64::from(r) / 255.0).abs() < 1e-4);
            prop_assert!((actual_g - f64::from(g) / 255.0).abs() < 1e-4);
            prop_assert!((actual_b - f64::from(b) / 255.0).abs() < 1e-4);
        }
    }

    // ── Helpers ──

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-6, "expected {b}, got {a}");
    }

    fn approx_delta(a: f64, b: f64, delta: f64) {
        assert!((a - b).abs() < delta, "expected {b} ±{delta}, got {a}");
    }
}
