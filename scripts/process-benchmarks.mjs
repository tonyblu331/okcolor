/**
 * Process vitest benchmark JSON output into structured data for Astro docs.
 * Usage: node scripts/process-benchmarks.mjs <path-to-bench-results.json>
 * Output: writes to packages/docs/src/data/benchmarks.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const resultsPath = process.argv[2];
if (!resultsPath) {
  console.error('Usage: node scripts/process-benchmarks.mjs <bench-results.json>');
  process.exit(1);
}

if (!existsSync(resultsPath)) {
  console.error(`File not found: ${resultsPath}`);
  process.exit(1);
}

const raw = JSON.parse(readFileSync(resultsPath, 'utf-8'));
const suites = raw?.benchmarks || [];

function findSuite(name) {
  return suites.find(s => s.name?.includes(name));
}

function extractMetrics(suite) {
  if (!suite?.benchmarks?.length) {
    const b = suite;
    if (!b) return null;
    return {
      hz: b.hz,
      mean: b.mean,
      min: b.min,
      max: b.max,
      p75: b.p75,
      p99: b.p99,
      rme: b.rme,
    };
  }
  return extractMetrics(suite.benchmarks[0]);
}

// Example mapping — adapt based on actual bench suite names:
const bottleneckSuite = suites.find(s => s.name?.includes('bottleneck.bench.ts'));
const compareSuite = suites.find(s => s.name?.includes('compare.bench.ts'));
const throughputSuite = suites.find(s => s.name?.includes('throughput.bench.ts'));

// throughput
const transform = extractMetrics(findSuite('mixed colors transform'));
const auditMix = extractMetrics(findSuite('audit mixed'));
const hexOnly = extractMetrics(findSuite('hex-only'));
const noColors = extractMetrics(findSuite('no-colors fast path'));
const namedOnly = extractMetrics(findSuite('named-only'));
const gradientTransform = extractMetrics(findSuite('gradient-heavy transform'));
const gradientAudit = extractMetrics(findSuite('gradient-heavy audit'));

// real-world from compare
const okcolorWhole = extractMetrics(findSuite('okcolor: whole-file'));
const audit100kb = findSuite('CSS Audit');
const audit100kbMetrics = audit100kb ? extractMetrics(audit100kb) : null;

// comparison from compare
const okcolorCached = extractMetrics(findSuite('okcolor cached'));
const culoriWhole = findSuite('Culori: whole-file');
const culoriWholeMetrics = culoriWhole ? extractMetrics(culoriWhole) : null;
const colorjsWhole = findSuite('color.js: whole-file');
const colorjsWholeMetrics = colorjsWhole ? extractMetrics(colorjsWhole) : null;

const output = {
  throughput: {
    transform: transform ? { hz: transform.hz, mean: transform.mean } : null,
    audit: auditMix ? { hz: auditMix.hz, mean: auditMix.mean } : null,
    hexOnly: hexOnly ? { hz: hexOnly.hz, mean: hexOnly.mean } : null,
    namedOnly: namedOnly ? { hz: namedOnly.hz, mean: namedOnly.mean } : null,
    noColors: noColors ? { hz: noColors.hz, mean: noColors.mean } : null,
    gradientTransform: gradientTransform ? { hz: gradientTransform.hz, mean: gradientTransform.mean } : null,
    gradientAudit: gradientAudit ? { hz: gradientAudit.hz, mean: gradientAudit.mean } : null,
  },
  realWorld: {
    wholeFile100kb: okcolorWhole ? { hz: okcolorWhole.hz, timeMs: okcolorWhole.mean * 1000 } : null,
    audit100kb: audit100kbMetrics ? { hz: audit100kbMetrics.hz, timeMs: audit100kbMetrics.mean * 1000 } : null,
  },
  comparison: {
    okcolor: okcolorWhole ? { hz: okcolorWhole.hz, timeMs: okcolorWhole.mean * 1000 } : null,
    culori: culoriWholeMetrics ? { hz: culoriWholeMetrics.hz, timeMs: culoriWholeMetrics.mean * 1000 } : null,
    colorjs: colorjsWholeMetrics ? { hz: colorjsWholeMetrics.hz, timeMs: colorjsWholeMetrics.mean * 1000 } : null,
  },
  cache: okcolorCached ? {
    perColorUs: (okcolorCached.mean / 100) * 1e6,
    hundredColorsTimeMs: okcolorCached.mean * 1000,
  } : null,
  timestamp: new Date().toISOString(),
};

const outputPath = resolve(__dirname, '..', 'packages', 'docs', 'src', 'data', 'benchmarks.json');
writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`Wrote benchmarks data to ${outputPath}`);
