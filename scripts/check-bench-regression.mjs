#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'

const actualPath = process.argv[2] ?? '.tmp/bench-results.json'
const baselinePath = process.argv[3] ?? 'bench/baseline.json'

if (!existsSync(actualPath)) {
  console.error(`Benchmark results not found: ${actualPath}`)
  process.exit(1)
}

if (!existsSync(baselinePath)) {
  console.error(`Benchmark baseline not found: ${baselinePath}`)
  process.exit(1)
}

const actual = JSON.parse(readFileSync(actualPath, 'utf8'))
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
const defaultTolerance = baseline.defaultTolerance ?? 0.2
const defaultMaxRme = baseline.maxRme ?? 10

function normalizePath(value) {
  return value.replaceAll('\\', '/')
}

function findBenchmark(metric) {
  const file = actual.files?.find((entry) =>
    normalizePath(entry.filepath ?? '').endsWith(metric.file),
  )
  const group = file?.groups?.find((entry) => entry.fullName?.includes(metric.group))
  const benchmark = group?.benchmarks?.find((entry) => entry.name === metric.name)

  return { file, group, benchmark }
}

const failures = []
const noisy = []
const rows = []

for (const metric of baseline.metrics ?? []) {
  const { benchmark } = findBenchmark(metric)

  if (!benchmark) {
    failures.push(`Missing benchmark: ${metric.file} > ${metric.group} > ${metric.name}`)
    continue
  }

  const tolerance = metric.tolerance ?? defaultTolerance
  const maxRme = metric.maxRme ?? defaultMaxRme
  const minHz = metric.baselineHz * (1 - tolerance)
  const hz = benchmark.hz
  const isNoisy = benchmark.rme > maxRme
  const passed = hz >= minHz || isNoisy

  rows.push({
    benchmark: metric.name,
    hz: hz.toFixed(2),
    minHz: minHz.toFixed(2),
    baselineHz: metric.baselineHz.toFixed(2),
    tolerance: `${Math.round(tolerance * 100)}%`,
    rme: `${benchmark.rme.toFixed(2)}%`,
    maxRme: `${maxRme.toFixed(2)}%`,
    samples: benchmark.sampleCount,
    status: isNoisy ? 'NOISY' : passed ? 'PASS' : 'FAIL',
  })

  if (isNoisy) {
    noisy.push(
      `${metric.name}: ${benchmark.rme.toFixed(2)}% RME > ${maxRme.toFixed(2)}% max; tracked but not failed because the run is too noisy`,
    )
  } else if (!passed) {
    failures.push(
      `${metric.name}: ${hz.toFixed(2)} hz < ${minHz.toFixed(2)} hz minimum (${metric.baselineHz} hz baseline, ${Math.round(tolerance * 100)}% tolerance)`,
    )
  }
}

console.table(rows)

if (noisy.length > 0) {
  console.warn('\nNoisy benchmark measurements:')
  for (const warning of noisy) {
    console.warn(`- ${warning}`)
  }
}

if (failures.length > 0) {
  console.error('\nBenchmark regression gate failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  console.error(
    `\nActual: ${relative(process.cwd(), actualPath)}\nBaseline: ${relative(process.cwd(), baselinePath)}`,
  )
  process.exit(1)
}

console.log('Benchmark regression gate passed.')
