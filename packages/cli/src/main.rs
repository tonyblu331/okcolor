use okcolor_core::convert_color;
use okcolor_core::transform_css;
use okcolor_core::{audit_css, diagnose_css};
use std::env;
use std::fs;
use std::time::Instant;

fn usage() {
    eprintln!("Usage:");
    eprintln!("  okcolor <color>                   Convert a colour to OKLCH");
    eprintln!("  okcolor <color> --to <space>      Convert to hex/rgb/hsl/hwb/oklch");
    eprintln!("  okcolor transform <css>            Transform a CSS string");
    eprintln!("  okcolor audit <file>               Audit colour usage in CSS file");
    eprintln!("  okcolor check <file> [--max-legacy N]  CI gate — fail on excess legacy colours");
    eprintln!("  okcolor doctor <file>              Diagnose colour usage in CSS file");
    eprintln!("  okcolor bench [--size-kb N]        Run performance benchmarks");
    eprintln!("  okcolor --help                     Show this help");
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();

    if args.is_empty() || args[0] == "--help" || args[0] == "-h" {
        usage();
        return;
    }

    match args[0].as_str() {
        "transform" => {
            let css = args[1..].join(" ");
            println!("{}", transform_css(&css));
        }
        "audit" => {
            let file = args.get(1).unwrap_or_else(|| { usage(); std::process::exit(1); });
            let css = fs::read_to_string(file).unwrap_or_else(|e| {
                eprintln!("error: cannot read '{}': {}", file, e);
                std::process::exit(1);
            });
            println!("{}", audit_css(&css));
        }
        "check" => {
            let file = args.get(1).unwrap_or_else(|| { usage(); std::process::exit(1); });
            let max_legacy: u32 = if args.len() >= 3 && args[2] == "--max-legacy" {
                args.get(3).and_then(|s| s.parse().ok()).unwrap_or(0)
            } else {
                0
            };
            let css = fs::read_to_string(file).unwrap_or_else(|e| {
                eprintln!("error: cannot read '{}': {}", file, e);
                std::process::exit(1);
            });
            let r = okcolor_core::scan_result(&css);
            if r.legacy_count > max_legacy {
                eprintln!("FAIL: {} legacy colours exceeds limit of {}", r.legacy_count, max_legacy);
                std::process::exit(1);
            }
            println!("PASS: {} legacy colours (limit: {})", r.legacy_count, max_legacy);
        }
        "doctor" => {
            let file = args.get(1).unwrap_or_else(|| { usage(); std::process::exit(1); });
            let css = fs::read_to_string(file).unwrap_or_else(|e| {
                eprintln!("error: cannot read '{}': {}", file, e);
                std::process::exit(1);
            });
            print!("{}", diagnose_css(&css));
        }
        "bench" => {
            let size_kb: usize = if args.len() >= 3 && args[1] == "--size-kb" {
                args.get(2).and_then(|s| s.parse().ok()).unwrap_or(100)
            } else {
                100
            };
            bench(size_kb);
        }
        _ => {
            if args.len() >= 3 && args[1] == "--to" {
                let input = &args[0];
                let space = &args[2];
                match convert_color(input, space) {
                    Some(out) => println!("{out}"),
                    None => {
                        eprintln!("error: unrecognised colour or space");
                        std::process::exit(1);
                    }
                }
                return;
            }

            let input = args.join(" ");
            match convert_color(&input, "oklch") {
                Some(out) => println!("{out}"),
                None => {
                    eprintln!("error: unrecognised colour");
                    std::process::exit(1);
                }
            }
        }
    }
}

fn bench(size_kb: usize) {
    let line = ".foo { color: #ff0000; background: rgb(0 255 0); border: 1px solid hsl(240 100% 50%); }\n";
    let repeat = (size_kb * 1024) / line.len();
    let css: String = (0..repeat).map(|i| {
        format!(".a-{i} {{ color: #ff0000; background: rgb(0 255 0); border: 1px solid hsl(240 100% 50%); }}\n")
    }).collect();
    let kb = css.len() as f64 / 1024.0;

    // Warmup
    for _ in 0..5 {
        let _ = okcolor_core::scan_result(&css);
    }

    // Transform
    let start = Instant::now();
    let iterations = 200;
    for _ in 0..iterations {
        let _ = transform_css(&css);
    }
    let elapsed = start.elapsed();
    let ops = iterations as f64 / elapsed.as_secs_f64();
    println!("transform: {:.0} ops/s ({:.1} KB, {} iterations)", ops, kb, iterations);

    // Audit (ScanResult, not JSON)
    let start = Instant::now();
    for _ in 0..iterations {
        let _ = okcolor_core::scan_result(&css);
    }
    let elapsed = start.elapsed();
    let ops = iterations as f64 / elapsed.as_secs_f64();
    println!("audit:    {:.0} ops/s ({:.1} KB, {} iterations)", ops, kb, iterations);

    // No-colors fast path
    let plain: String = (0..repeat).map(|i| {
        format!(".a-{i} {{ display: flex; }}\n")
    }).collect();
    let start = Instant::now();
    for _ in 0..iterations {
        let _ = okcolor_core::scan_result(&plain);
    }
    let elapsed = start.elapsed();
    let ops = iterations as f64 / elapsed.as_secs_f64();
    println!("no-color: {:.0} ops/s ({:.1} KB, {} iterations)", ops, kb, iterations);
}

#[test]
fn test_oklch_default() {
    assert_eq!(
        okcolor_core::convert_color("#ff0000", "oklch"),
        Some("oklch(62.8% 0.25768 29.23)".into())
    );
}

#[test]
fn test_audit_json() {
    let css = "a { color: red; }";
    let json = okcolor_core::audit_css(css);
    assert!(json.contains("\"named_count\":1"));
    assert!(json.contains("\"legacy_count\":1"));
}

#[test]
fn test_diagnose() {
    let css = "a { color: red; }";
    let report = okcolor_core::diagnose_css(css);
    assert!(report.contains("legacy"));
    assert!(report.contains("named"));
}

#[test]
fn test_check_pass() {
    let r = okcolor_core::scan_result("a { color: red; }");
    assert_eq!(r.legacy_count, 1);
}

#[test]
fn test_bench() {
    // Quick smoke test — bench with tiny input
    let css = ".x { color: #ff0000; }";
    assert!(okcolor_core::scan_result(&css).legacy_count >= 1);
}
