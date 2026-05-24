const path = require('path');
const wasm = require(path.join(__dirname, '../packages/core-wasm/pkg-nodejs/ok_actually_core.js'));
const { converter, parse } = require('culori');

const encoder = new TextEncoder();

function wasmToOklch(cssColor) {
  const result = wasm.transform_css(encoder.encode(`a { color: ${cssColor}; }`));
  const match = result.match(/oklch\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split('/').map(s => s.trim());
  const [l, c, h] = parts[0].split(/\s+/).map(parseFloat);
  const alpha = parts[1] ? parseFloat(parts[1]) : undefined;
  return { l: l / 100, c, h, alpha };
}

function culoriToOklch(cssColor) {
  const parsed = parse(cssColor);
  if (!parsed) return null;
  const ok = converter('oklch')(parsed);
  if (!ok) return null;
  return {
    l: ok.l,
    c: ok.c,
    h: ok.h ?? 0,
    alpha: ok.alpha
  };
}

function compare(name, cssColor) {
  const w = wasmToOklch(cssColor);
  const c = culoriToOklch(cssColor);
  if (!w || !c) {
    return { name, cssColor, wasm: w, culori: c, error: 'parse failed' };
  }

  const dL = Math.abs(w.l - c.l);
  const dC = Math.abs(w.c - c.c);
  const dH = Math.abs(w.h - c.h);
  const hueDiff = Math.abs(((dH + 180) % 360) - 180);

  return {
    name,
    cssColor,
    wasm: w,
    culori: c,
    dL, dC, dH: hueDiff,
    maxErr: Math.max(dL, dC, hueDiff / 360)
  };
}

const tests = [
  ['red', '#ff0000'],
  ['green', '#00ff00'],
  ['blue', '#0000ff'],
  ['cyan', '#00ffff'],
  ['magenta', '#ff00ff'],
  ['yellow', '#ffff00'],
  ['white', '#ffffff'],
  ['black', '#000000'],
  ['gray50', '#808080'],
  ['gray128', 'rgb(128, 128, 128)'],
  ['rebeccapurple', 'rebeccapurple'],
  ['orange', 'orange'],
  ['pink', 'pink'],
  ['teal', 'teal'],
  ['hsl red', 'hsl(0, 100%, 50%)'],
  ['hsl green', 'hsl(120, 100%, 50%)'],
  ['hsl blue', 'hsl(240, 100%, 50%)'],
  ['hsl white', 'hsl(0, 0%, 100%)'],
  ['hsl black', 'hsl(0, 0%, 0%)'],
  ['hsl gray', 'hsl(0, 0%, 50%)'],
  ['hwb red', 'hwb(0 0% 0%)'],
  ['hwb green', 'hwb(120 0% 0%)'],
  ['hwb blue', 'hwb(240 0% 0%)'],
  ['hwb white', 'hwb(0 100% 0%)'],
  ['hwb black', 'hwb(0 0% 100%)'],
  ['hwb gray', 'hwb(0 50% 50%)'],
  ['color-srgb red', 'color(srgb 1 0 0)'],
  ['color-srgb green', 'color(srgb 0 1 0)'],
  ['color-srgb blue', 'color(srgb 0 0 1)'],
  ['red 50%', 'rgba(255, 0, 0, 0.5)'],
  ['hex alpha', '#ff000080'],
  ['hsl alpha', 'hsla(0, 100%, 50%, 0.5)'],
  ['hwb alpha', 'hwb(0 0% 0% / 0.5)'],
  ['very dark', '#010101'],
  ['very light', '#fefefe'],
  ['near gray', '#7f7f7f'],
  ['near gray2', '#818181'],
  ['srgb 1.5', 'color(srgb 1.5 0 0)'],
  ['srgb -0.5', 'color(srgb -0.5 0 0)'],
  ['short red', '#f00'],
  ['short gray', '#888'],
];

console.log('═══ OKLCH Math Verification against Culori ═══\n');

let maxDL = 0, maxDC = 0, maxDH = 0;
let worstL = null, worstC = null, worstH = null;
let failures = 0;

for (const [name, css] of tests) {
  const r = compare(name, css);
  if (r.error) {
    console.log(`  FAIL ${name.padEnd(20)} ${css}`);
    failures++;
    continue;
  }

  const ok = r.dL < 5e-5 && r.dC < 5e-5 && r.dH < 0.05;
  if (!ok) {
    failures++;
    console.log(`  ✗ ${name.padEnd(20)} L=${r.wasm.l.toFixed(6)} vs ${r.culori.l.toFixed(6)} Δ=${r.dL.toExponential(2)} | C=${r.wasm.c.toFixed(6)} vs ${r.culori.c.toFixed(6)} Δ=${r.dC.toExponential(2)} | H=${r.wasm.h.toFixed(4)} vs ${r.culori.h.toFixed(4)} Δ=${r.dH.toFixed(4)}`);
  }
}

console.log(`\n═══ Summary ═══`);
console.log(`  Total tests: ${tests.length}`);
console.log(`  Failures:    ${failures}`);

// Round-trip grid
console.log(`\n═══ Round-trip grid (sampled) ═══`);
let roundTripMax = 0;
let roundTripWorst = null;
let count = 0;
for (let r = 0; r < 256; r += 17) {
  for (let g = 0; g < 256; g += 17) {
    for (let b = 0; b < 256; b += 17) {
      count++;
      const css = `rgb(${r}, ${g}, ${b})`;
      const w = wasmToOklch(css);
      const c = culoriToOklch(css);
      if (w && c) {
        const dL = Math.abs(w.l - c.l);
        const dC = Math.abs(w.c - c.c);
        const hueDiff = Math.abs(((Math.abs(w.h - c.h) + 180) % 360) - 180);
        const err = Math.max(dL, dC, hueDiff / 360);
        if (err > roundTripMax) {
          roundTripMax = err;
          roundTripWorst = { r, g, b, dL, dC, dH: hueDiff };
        }
      }
    }
  }
}
console.log(`  Sampled ${count} colors`);
console.log(`  Max error: ${roundTripMax.toExponential(2)}`);
if (roundTripWorst) {
  console.log(`  Worst: rgb(${roundTripWorst.r},${roundTripWorst.g},${roundTripWorst.b})  ΔL=${roundTripWorst.dL.toExponential(2)} ΔC=${roundTripWorst.dC.toExponential(2)} ΔH=${roundTripWorst.dH.toFixed(4)}`);
}
