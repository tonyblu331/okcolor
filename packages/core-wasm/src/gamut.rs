use crate::math;

const EPSILON: f64 = 0.000_001;
const NEUTRAL_CHROMA_THRESHOLD: f64 = 0.02;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gamut {
    Srgb,
    DisplayP3,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Oklch {
    pub l: f64,
    pub c: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChromaTransform {
    pub color: Oklch,
    pub c_max: f64,
    pub in_gamut: bool,
    pub neutral_skipped: bool,
}

pub fn parse_gamut(input: &str) -> Option<Gamut> {
    match input {
        "srgb" => Some(Gamut::Srgb),
        "p3" | "display-p3" => Some(Gamut::DisplayP3),
        _ => None,
    }
}

pub fn is_in_gamut(color: Oklch, gamut: Gamut) -> bool {
    let (r, g, b) = match gamut {
        Gamut::Srgb => oklch_to_linear_srgb(color),
        Gamut::DisplayP3 => oklch_to_linear_display_p3(color),
    };

    is_unit(r) && is_unit(g) && is_unit(b)
}

pub fn find_chroma_max(l: f64, h: f64, gamut: Gamut) -> f64 {
    let mut low = 0.0;
    let mut high = 0.5;

    while high < 2.0 && is_in_gamut(Oklch { l, c: high, h }, gamut) {
        low = high;
        high *= 2.0;
    }

    for _ in 0..32 {
        let mid = (low + high) / 2.0;
        if is_in_gamut(Oklch { l, c: mid, h }, gamut) {
            low = mid;
        } else {
            high = mid;
        }
    }

    round(low, 5)
}

pub fn expand_chroma(source: Oklch, gamut: Gamut, amount: f64) -> ChromaTransform {
    let c_max = find_chroma_max(source.l, source.h, gamut);
    if source.c < NEUTRAL_CHROMA_THRESHOLD {
        return ChromaTransform {
            color: source,
            c_max,
            in_gamut: is_in_gamut(source, gamut),
            neutral_skipped: true,
        };
    }

    let amount = amount.clamp(0.0, 1.0);
    let c = source.c + amount * (c_max - source.c).max(0.0);
    let color = Oklch {
        c: c.min(c_max),
        ..source
    };

    ChromaTransform {
        color,
        c_max,
        in_gamut: is_in_gamut(color, gamut),
        neutral_skipped: false,
    }
}

pub fn fit_gamut(source: Oklch, gamut: Gamut) -> ChromaTransform {
    let c_max = find_chroma_max(source.l, source.h, gamut);
    let color = if is_in_gamut(source, gamut) {
        source
    } else {
        Oklch {
            c: source.c.min(c_max),
            ..source
        }
    };

    ChromaTransform {
        color,
        c_max,
        in_gamut: is_in_gamut(color, gamut),
        neutral_skipped: false,
    }
}

pub fn relative_luminance(color: Oklch) -> f64 {
    let (_, y, _) = oklch_to_xyz(color);
    y.clamp(0.0, 1.0)
}

fn oklch_to_linear_srgb(color: Oklch) -> (f64, f64, f64) {
    let (l, a, b) = oklch_to_oklab(color);
    math::oklab_to_linear_srgb(l, a, b)
}

fn oklch_to_linear_display_p3(color: Oklch) -> (f64, f64, f64) {
    let (x, y, z) = oklch_to_xyz(color);
    (
        2.493496911941425 * x - 0.9313836179191239 * y - 0.40271078445071684 * z,
        -0.8294889695615747 * x + 1.7626640603183463 * y + 0.023624685841943577 * z,
        0.03584583024378447 * x - 0.07617238926804182 * y + 0.9568845240076872 * z,
    )
}

fn oklch_to_xyz(color: Oklch) -> (f64, f64, f64) {
    let (ok_l, a, b) = oklch_to_oklab(color);
    let l_ = ok_l + 0.3963377774 * a + 0.2158037573 * b;
    let m_ = ok_l - 0.1055613458 * a - 0.0638541728 * b;
    let s_ = ok_l - 0.0894841775 * a - 1.2914855480 * b;

    let l = l_ * l_ * l_;
    let m = m_ * m_ * m_;
    let s = s_ * s_ * s_;

    (
        1.2268798733741557 * l - 0.5578149965554813 * m + 0.28139105017721583 * s,
        -0.04057576262431372 * l + 1.1122868293970594 * m - 0.07171106666151701 * s,
        -0.07637294974672142 * l - 0.4214933239627914 * m + 1.5869240244272418 * s,
    )
}

fn oklch_to_oklab(color: Oklch) -> (f64, f64, f64) {
    let h = color.h.to_radians();
    (color.l, color.c * h.cos(), color.c * h.sin())
}

fn is_unit(value: f64) -> bool {
    (-EPSILON..=1.0 + EPSILON).contains(&value)
}

fn round(value: f64, places: i32) -> f64 {
    let factor = 10_f64.powi(places);
    (value * factor).round() / factor
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn p3_chroma_ceiling_is_above_orange_source_chroma() {
        let source = Oklch {
            l: 0.681,
            c: 0.211,
            h: 41.8,
        };
        let c_max = find_chroma_max(source.l, source.h, Gamut::DisplayP3);
        assert!(c_max >= source.c);
    }

    #[test]
    fn expansion_preserves_lightness_and_hue() {
        let source = Oklch {
            l: 0.681,
            c: 0.211,
            h: 41.8,
        };
        let expanded = expand_chroma(source, Gamut::DisplayP3, 0.75);
        assert_eq!(expanded.color.l, source.l);
        assert_eq!(expanded.color.h, source.h);
        assert!(expanded.color.c >= source.c);
        assert!(expanded.in_gamut);
    }

    #[test]
    fn neutral_expansion_is_skipped() {
        let source = Oklch {
            l: 0.6,
            c: 0.005,
            h: 0.0,
        };
        let expanded = expand_chroma(source, Gamut::DisplayP3, 1.0);
        assert_eq!(expanded.color.c, source.c);
        assert!(expanded.neutral_skipped);
    }

    #[test]
    fn fit_reduces_out_of_srgb_chroma() {
        let source = Oklch {
            l: 0.7,
            c: 0.35,
            h: 145.0,
        };
        let fitted = fit_gamut(source, Gamut::Srgb);
        assert!(fitted.color.c < source.c);
        assert!(fitted.in_gamut);
    }

    #[test]
    fn relative_luminance_orders_black_and_white() {
        let black = relative_luminance(Oklch {
            l: 0.0,
            c: 0.0,
            h: 0.0,
        });
        let white = relative_luminance(Oklch {
            l: 1.0,
            c: 0.0,
            h: 0.0,
        });
        assert!(black < white);
        assert!(white > 0.99);
    }
}
