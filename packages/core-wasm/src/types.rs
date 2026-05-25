/// Gamma-encoded sRGB color (the canonical intermediate for all conversions).
///
/// Every CSS colour format parses to `RawColor`, and every formatter
/// formats from `RawColor`. This is the hub in the hub-and-spoke design.
#[derive(Debug, Clone, PartialEq)]
pub struct RawColor {
    /// Red channel, gamma-encoded sRGB [`0.0`, `1.0`].
    pub r: f64,
    /// Green channel, gamma-encoded sRGB [`0.0`, `1.0`].
    pub g: f64,
    /// Blue channel, gamma-encoded sRGB [`0.0`, `1.0`].
    pub b: f64,
    /// Optional alpha channel. `None` means fully opaque (α = 1.0).
    pub alpha: Option<f64>,
}
