use std::sync::LazyLock;

use aho_corasick::AhoCorasick;
use phf::phf_map;

/// 148 CSS Color Module Level 4 named colors (case-insensitive keys).
pub(crate) const NAMED_PAIRS: &[(&str, [u8; 3])] = &[
    ("aliceblue", [240, 248, 255]),
    ("antiquewhite", [250, 235, 215]),
    ("aqua", [0, 255, 255]),
    ("aquamarine", [127, 255, 212]),
    ("azure", [240, 255, 255]),
    ("beige", [245, 245, 220]),
    ("bisque", [255, 228, 196]),
    ("black", [0, 0, 0]),
    ("blanchedalmond", [255, 235, 205]),
    ("blue", [0, 0, 255]),
    ("blueviolet", [138, 43, 226]),
    ("brown", [165, 42, 42]),
    ("burlywood", [222, 184, 135]),
    ("cadetblue", [95, 158, 160]),
    ("chartreuse", [127, 255, 0]),
    ("chocolate", [210, 105, 30]),
    ("coral", [255, 127, 80]),
    ("cornflowerblue", [100, 149, 237]),
    ("cornsilk", [255, 248, 220]),
    ("crimson", [220, 20, 60]),
    ("cyan", [0, 255, 255]),
    ("darkblue", [0, 0, 139]),
    ("darkcyan", [0, 139, 139]),
    ("darkgoldenrod", [184, 134, 11]),
    ("darkgray", [169, 169, 169]),
    ("darkgreen", [0, 100, 0]),
    ("darkgrey", [169, 169, 169]),
    ("darkkhaki", [189, 183, 107]),
    ("darkmagenta", [139, 0, 139]),
    ("darkolivegreen", [85, 107, 47]),
    ("darkorange", [255, 140, 0]),
    ("darkorchid", [153, 50, 204]),
    ("darkred", [139, 0, 0]),
    ("darksalmon", [233, 150, 122]),
    ("darkseagreen", [143, 188, 143]),
    ("darkslateblue", [72, 61, 139]),
    ("darkslategray", [47, 79, 79]),
    ("darkslategrey", [47, 79, 79]),
    ("darkturquoise", [0, 206, 209]),
    ("darkviolet", [148, 0, 211]),
    ("deeppink", [255, 20, 147]),
    ("deepskyblue", [0, 191, 255]),
    ("dimgray", [105, 105, 105]),
    ("dimgrey", [105, 105, 105]),
    ("dodgerblue", [30, 144, 255]),
    ("firebrick", [178, 34, 34]),
    ("floralwhite", [255, 250, 240]),
    ("forestgreen", [34, 139, 34]),
    ("fuchsia", [255, 0, 255]),
    ("gainsboro", [220, 220, 220]),
    ("ghostwhite", [248, 248, 255]),
    ("gold", [255, 215, 0]),
    ("goldenrod", [218, 165, 32]),
    ("gray", [128, 128, 128]),
    ("green", [0, 128, 0]),
    ("greenyellow", [173, 255, 47]),
    ("grey", [128, 128, 128]),
    ("honeydew", [240, 255, 240]),
    ("hotpink", [255, 105, 180]),
    ("indianred", [205, 92, 92]),
    ("indigo", [75, 0, 130]),
    ("ivory", [255, 255, 240]),
    ("khaki", [240, 230, 140]),
    ("lavender", [230, 230, 250]),
    ("lavenderblush", [255, 240, 245]),
    ("lawngreen", [124, 252, 0]),
    ("lemonchiffon", [255, 250, 205]),
    ("lightblue", [173, 216, 230]),
    ("lightcoral", [240, 128, 128]),
    ("lightcyan", [224, 255, 255]),
    ("lightgoldenrodyellow", [250, 250, 210]),
    ("lightgray", [211, 211, 211]),
    ("lightgreen", [144, 238, 144]),
    ("lightgrey", [211, 211, 211]),
    ("lightpink", [255, 182, 193]),
    ("lightsalmon", [255, 160, 122]),
    ("lightseagreen", [32, 178, 170]),
    ("lightskyblue", [135, 206, 250]),
    ("lightslategray", [119, 136, 153]),
    ("lightslategrey", [119, 136, 153]),
    ("lightsteelblue", [176, 196, 222]),
    ("lightyellow", [255, 255, 224]),
    ("lime", [0, 255, 0]),
    ("limegreen", [50, 205, 50]),
    ("linen", [250, 240, 230]),
    ("magenta", [255, 0, 255]),
    ("maroon", [128, 0, 0]),
    ("mediumaquamarine", [102, 205, 170]),
    ("mediumblue", [0, 0, 205]),
    ("mediumorchid", [186, 85, 211]),
    ("mediumpurple", [147, 112, 219]),
    ("mediumseagreen", [60, 179, 113]),
    ("mediumslateblue", [123, 104, 238]),
    ("mediumspringgreen", [0, 250, 154]),
    ("mediumturquoise", [72, 209, 204]),
    ("mediumvioletred", [199, 21, 133]),
    ("midnightblue", [25, 25, 112]),
    ("mintcream", [245, 255, 250]),
    ("mistyrose", [255, 228, 225]),
    ("moccasin", [255, 228, 181]),
    ("navajowhite", [255, 222, 173]),
    ("navy", [0, 0, 128]),
    ("oldlace", [253, 245, 230]),
    ("olive", [128, 128, 0]),
    ("olivedrab", [107, 142, 35]),
    ("orange", [255, 165, 0]),
    ("orangered", [255, 69, 0]),
    ("orchid", [218, 112, 214]),
    ("palegoldenrod", [238, 232, 170]),
    ("palegreen", [152, 251, 152]),
    ("paleturquoise", [175, 238, 238]),
    ("palevioletred", [219, 112, 147]),
    ("papayawhip", [255, 239, 213]),
    ("peachpuff", [255, 218, 185]),
    ("peru", [205, 133, 63]),
    ("pink", [255, 192, 203]),
    ("plum", [221, 160, 221]),
    ("powderblue", [176, 224, 230]),
    ("purple", [128, 0, 128]),
    ("rebeccapurple", [102, 51, 153]),
    ("red", [255, 0, 0]),
    ("rosybrown", [188, 143, 143]),
    ("royalblue", [65, 105, 225]),
    ("saddlebrown", [139, 69, 19]),
    ("salmon", [250, 128, 114]),
    ("sandybrown", [244, 164, 96]),
    ("seagreen", [46, 139, 87]),
    ("seashell", [255, 245, 238]),
    ("sienna", [160, 82, 45]),
    ("silver", [192, 192, 192]),
    ("skyblue", [135, 206, 235]),
    ("slateblue", [106, 90, 205]),
    ("slategray", [112, 128, 144]),
    ("slategrey", [112, 128, 144]),
    ("snow", [255, 250, 250]),
    ("springgreen", [0, 255, 127]),
    ("steelblue", [70, 130, 180]),
    ("tan", [210, 180, 140]),
    ("teal", [0, 128, 128]),
    ("thistle", [216, 191, 216]),
    ("tomato", [255, 99, 71]),
    ("turquoise", [64, 224, 208]),
    ("violet", [238, 130, 238]),
    ("wheat", [245, 222, 179]),
    ("white", [255, 255, 255]),
    ("whitesmoke", [245, 245, 245]),
    ("yellow", [255, 255, 0]),
    ("yellowgreen", [154, 205, 50]),
];

static NAMED_MAP: phf::Map<&'static str, [u8; 3]> = phf_map! {
    "aliceblue" => [240, 248, 255],
    "antiquewhite" => [250, 235, 215],
    "aqua" => [0, 255, 255],
    "aquamarine" => [127, 255, 212],
    "azure" => [240, 255, 255],
    "beige" => [245, 245, 220],
    "bisque" => [255, 228, 196],
    "black" => [0, 0, 0],
    "blanchedalmond" => [255, 235, 205],
    "blue" => [0, 0, 255],
    "blueviolet" => [138, 43, 226],
    "brown" => [165, 42, 42],
    "burlywood" => [222, 184, 135],
    "cadetblue" => [95, 158, 160],
    "chartreuse" => [127, 255, 0],
    "chocolate" => [210, 105, 30],
    "coral" => [255, 127, 80],
    "cornflowerblue" => [100, 149, 237],
    "cornsilk" => [255, 248, 220],
    "crimson" => [220, 20, 60],
    "cyan" => [0, 255, 255],
    "darkblue" => [0, 0, 139],
    "darkcyan" => [0, 139, 139],
    "darkgoldenrod" => [184, 134, 11],
    "darkgray" => [169, 169, 169],
    "darkgreen" => [0, 100, 0],
    "darkgrey" => [169, 169, 169],
    "darkkhaki" => [189, 183, 107],
    "darkmagenta" => [139, 0, 139],
    "darkolivegreen" => [85, 107, 47],
    "darkorange" => [255, 140, 0],
    "darkorchid" => [153, 50, 204],
    "darkred" => [139, 0, 0],
    "darksalmon" => [233, 150, 122],
    "darkseagreen" => [143, 188, 143],
    "darkslateblue" => [72, 61, 139],
    "darkslategray" => [47, 79, 79],
    "darkslategrey" => [47, 79, 79],
    "darkturquoise" => [0, 206, 209],
    "darkviolet" => [148, 0, 211],
    "deeppink" => [255, 20, 147],
    "deepskyblue" => [0, 191, 255],
    "dimgray" => [105, 105, 105],
    "dimgrey" => [105, 105, 105],
    "dodgerblue" => [30, 144, 255],
    "firebrick" => [178, 34, 34],
    "floralwhite" => [255, 250, 240],
    "forestgreen" => [34, 139, 34],
    "fuchsia" => [255, 0, 255],
    "gainsboro" => [220, 220, 220],
    "ghostwhite" => [248, 248, 255],
    "gold" => [255, 215, 0],
    "goldenrod" => [218, 165, 32],
    "gray" => [128, 128, 128],
    "green" => [0, 128, 0],
    "greenyellow" => [173, 255, 47],
    "grey" => [128, 128, 128],
    "honeydew" => [240, 255, 240],
    "hotpink" => [255, 105, 180],
    "indianred" => [205, 92, 92],
    "indigo" => [75, 0, 130],
    "ivory" => [255, 255, 240],
    "khaki" => [240, 230, 140],
    "lavender" => [230, 230, 250],
    "lavenderblush" => [255, 240, 245],
    "lawngreen" => [124, 252, 0],
    "lemonchiffon" => [255, 250, 205],
    "lightblue" => [173, 216, 230],
    "lightcoral" => [240, 128, 128],
    "lightcyan" => [224, 255, 255],
    "lightgoldenrodyellow" => [250, 250, 210],
    "lightgray" => [211, 211, 211],
    "lightgreen" => [144, 238, 144],
    "lightgrey" => [211, 211, 211],
    "lightpink" => [255, 182, 193],
    "lightsalmon" => [255, 160, 122],
    "lightseagreen" => [32, 178, 170],
    "lightskyblue" => [135, 206, 250],
    "lightslategray" => [119, 136, 153],
    "lightslategrey" => [119, 136, 153],
    "lightsteelblue" => [176, 196, 222],
    "lightyellow" => [255, 255, 224],
    "lime" => [0, 255, 0],
    "limegreen" => [50, 205, 50],
    "linen" => [250, 240, 230],
    "magenta" => [255, 0, 255],
    "maroon" => [128, 0, 0],
    "mediumaquamarine" => [102, 205, 170],
    "mediumblue" => [0, 0, 205],
    "mediumorchid" => [186, 85, 211],
    "mediumpurple" => [147, 112, 219],
    "mediumseagreen" => [60, 179, 113],
    "mediumslateblue" => [123, 104, 238],
    "mediumspringgreen" => [0, 250, 154],
    "mediumturquoise" => [72, 209, 204],
    "mediumvioletred" => [199, 21, 133],
    "midnightblue" => [25, 25, 112],
    "mintcream" => [245, 255, 250],
    "mistyrose" => [255, 228, 225],
    "moccasin" => [255, 228, 181],
    "navajowhite" => [255, 222, 173],
    "navy" => [0, 0, 128],
    "oldlace" => [253, 245, 230],
    "olive" => [128, 128, 0],
    "olivedrab" => [107, 142, 35],
    "orange" => [255, 165, 0],
    "orangered" => [255, 69, 0],
    "orchid" => [218, 112, 214],
    "palegoldenrod" => [238, 232, 170],
    "palegreen" => [152, 251, 152],
    "paleturquoise" => [175, 238, 238],
    "palevioletred" => [219, 112, 147],
    "papayawhip" => [255, 239, 213],
    "peachpuff" => [255, 218, 185],
    "peru" => [205, 133, 63],
    "pink" => [255, 192, 203],
    "plum" => [221, 160, 221],
    "powderblue" => [176, 224, 230],
    "purple" => [128, 0, 128],
    "rebeccapurple" => [102, 51, 153],
    "red" => [255, 0, 0],
    "rosybrown" => [188, 143, 143],
    "royalblue" => [65, 105, 225],
    "saddlebrown" => [139, 69, 19],
    "salmon" => [250, 128, 114],
    "sandybrown" => [244, 164, 96],
    "seagreen" => [46, 139, 87],
    "seashell" => [255, 245, 238],
    "sienna" => [160, 82, 45],
    "silver" => [192, 192, 192],
    "skyblue" => [135, 206, 235],
    "slateblue" => [106, 90, 205],
    "slategray" => [112, 128, 144],
    "slategrey" => [112, 128, 144],
    "snow" => [255, 250, 250],
    "springgreen" => [0, 255, 127],
    "steelblue" => [70, 130, 180],
    "tan" => [210, 180, 140],
    "teal" => [0, 128, 128],
    "thistle" => [216, 191, 216],
    "tomato" => [255, 99, 71],
    "turquoise" => [64, 224, 208],
    "violet" => [238, 130, 238],
    "wheat" => [245, 222, 179],
    "white" => [255, 255, 255],
    "whitesmoke" => [245, 245, 245],
    "yellow" => [255, 255, 0],
    "yellowgreen" => [154, 205, 50],
};

/// Look up a CSS named color by its lowercase name.
///
/// Returns `None` for unknown names (including `transparent`,
/// which is handled separately by the scanner).
pub fn lookup(name: &str) -> Option<[u8; 3]> {
    NAMED_MAP.get(name).copied()
}

pub fn is_named(name: &str) -> bool {
    NAMED_MAP.contains_key(name)
}

/// Look up a CSS named color by its lowercase byte slice.
#[allow(dead_code)]
pub fn lookup_bytes(name: &[u8]) -> Option<[u8; 3]> {
    let name_str = std::str::from_utf8(name).ok()?;
    NAMED_MAP.get(name_str).copied()
}

/// Check if the given lowercase byte slice is a CSS named color.
#[allow(dead_code)]
pub fn is_named_bytes(name: &[u8]) -> bool {
    std::str::from_utf8(name)
        .ok()
        .is_some_and(|s| NAMED_MAP.contains_key(s))
}

/// Aho-Corasick automaton for all 148 named colours.
/// Built once via `LazyLock` — does a *single* linear scan of the input
/// to detect ANY named colour string, regardless of case.
#[allow(dead_code)]
static NAMED_AC: LazyLock<AhoCorasick> = LazyLock::new(|| {
    AhoCorasick::builder()
        .ascii_case_insensitive(true)
        .build(NAMED_PAIRS.iter().map(|(name, _)| *name))
        .expect("valid ASCII named-color patterns")
});

/// Returns `true` if `bytes` contains any CSS named colour string
/// (case-insensitive, ASCII only).
///
/// May return **false positives** for substrings (e.g. `"red"` inside
/// `"reduce"`) but NEVER returns false negatives — every named colour is
/// guaranteed to be found.  This is intentionally conservative for the
/// pre-scan bail-out: a false positive just runs the full scan (correct),
/// while a false negative would skip a transform (broken).
#[allow(dead_code)]
pub fn has_named(bytes: &[u8]) -> bool {
    NAMED_AC.is_match(bytes)
}

/// Counts approximate named colour occurrences in `bytes`.
///
/// Conservative upper bound (intentionally over-counts via overlapping
/// matches + substring false positives) — safe for output capacity
/// pre-allocation.
#[allow(dead_code)]
pub fn count_named(bytes: &[u8]) -> usize {
    NAMED_AC.find_iter(bytes).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_all_148_names_loaded() {
        assert_eq!(NAMED_MAP.len(), 148);
    }

    #[test]
    fn test_all_148_names_resolve_correctly() {
        for &(name, expected_rgb) in NAMED_PAIRS {
            let actual = lookup(name).expect(name);
            assert_eq!(actual, expected_rgb, "mismatch for {name}");
        }
    }

    #[test]
    fn test_lookup_known() {
        assert_eq!(lookup("red"), Some([255, 0, 0]));
        assert_eq!(lookup("blue"), Some([0, 0, 255]));
    }

    #[test]
    fn test_lookup_bytes() {
        assert_eq!(lookup_bytes(b"red"), Some([255, 0, 0]));
        assert_eq!(lookup_bytes(b"blue"), Some([0, 0, 255]));
        assert_eq!(lookup_bytes(b"transparent"), None);
    }

    #[test]
    fn test_is_named_bytes() {
        assert!(is_named_bytes(b"rebeccapurple"));
        assert!(!is_named_bytes(b"nonexistent"));
    }

    #[test]
    fn test_lookup_bytes_invalid_utf8_returns_none() {
        assert_eq!(lookup_bytes(&[0xFF, 0xFE]), None);
    }

    #[test]
    fn test_lookup_bytes_empty_returns_none() {
        assert_eq!(lookup_bytes(b""), None);
    }

    #[test]
    fn test_is_named_bytes_invalid_utf8_returns_false() {
        assert!(!is_named_bytes(&[0xFF, 0xFE]));
    }

    #[test]
    fn test_lookup_transparent_not_found() {
        assert_eq!(lookup("transparent"), None);
    }

    #[test]
    fn test_lookup_grey_alias() {
        assert_eq!(lookup("grey"), Some([128, 128, 128]));
        assert_eq!(lookup("gray"), Some([128, 128, 128]));
    }

    #[test]
    fn test_is_named() {
        assert!(is_named("rebeccapurple"));
        assert!(!is_named("nonexistent"));
    }

    // ── has_named (Aho-Corasick) ──

    #[test]
    fn test_has_named_finds_red() {
        assert!(has_named(b"color: red;"));
    }

    #[test]
    fn test_has_named_case_insensitive() {
        assert!(has_named(b"color: RED;"));
        assert!(has_named(b"color: Red;"));
    }

    #[test]
    fn test_has_named_rebeccapurple() {
        assert!(has_named(b"rebeccapurple"));
    }

    #[test]
    fn test_has_named_transparent_not_found() {
        assert!(!has_named(b"color: transparent;"));
    }

    #[test]
    fn test_has_named_no_colors() {
        assert!(!has_named(b"a { display: flex; }"));
    }

    #[test]
    fn test_has_named_false_positive_substring_is_safe() {
        // "grayscale" contains "gray" – false positive is OK
        assert!(has_named(b"filter: grayscale(50%);"));
    }
}
