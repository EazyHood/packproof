#!/usr/bin/env node
/**
 * PackProof CLI
 *
 * Usage:
 *   packproof --fixture <dir> --contract <file> --out <dir> [--timeout <ms>] [--case <name>]
 *   packproof --demo [--out <dir>]
 *
 * --fixture   Path to the fixture package source directory (must contain package.json)
 * --contract  Path to the consumer contract .mjs file
 * --out       Directory where run artifacts and the JSON report are written
 * --timeout   Contract timeout in milliseconds (default: 15000)
 * --case      Human label for this run (default: <fixture>+<contract>)
 * --demo      Run the full six-case demo against validation-fixtures/
 * --help      Show this help message
 *
 * Exit codes:
 *   0  All runs PASS
 *   1  At least one run is FAIL or INCONCLUSIVE, or bad input
 */

import { parseArgs } from 'node:util';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCase } from './runner.mjs';
import { DEFAULT_TIMEOUT_MS } from './run-contract.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const HELP = `
PackProof — archive consumer verification

Usage:
  packproof --fixture <dir> --contract <file> --out <dir> [options]
  packproof --demo [--out <dir>]

Options:
  --fixture  <dir>   Path to fixture package source directory
  --contract <file>  Path to consumer contract .mjs file
  --out      <dir>   Output directory for run artifacts and JSON report
  --timeout  <ms>    Contract timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})
  --case     <name>  Human label for this run
  --demo             Run the full demo against validation-fixtures/
  --help             Show this help
`.trim();

function parseCliArgs(argv) {
  try {
    return parseArgs({
      args: argv.slice(2),
      options: {
        fixture:  { type: 'string' },
        contract: { type: 'string' },
        out:      { type: 'string' },
        timeout:  { type: 'string' },
        case:     { type: 'string' },
        demo:     { type: 'boolean', default: false },
        help:     { type: 'boolean', default: false },
      },
      strict: true,
    });
  } catch (err) {
    return { error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Demo matrix
// ---------------------------------------------------------------------------

const DEMO_CASES = [
  {
    caseName: 'missing-template-operation',
    fixture: 'labels-missing-template',
    contract: 'label-operation.mjs',
    expectedOutcome: 'FAIL',
  },
  {
    caseName: 'missing-template-import-only',
    fixture: 'labels-missing-template',
    contract: 'label-import-only.mjs',
    expectedOutcome: 'PASS',
  },
  {
    caseName: 'fixed-operation',
    fixture: 'labels-fixed',
    contract: 'label-operation.mjs',
    expectedOutcome: 'PASS',
  },
  {
    caseName: 'fixed-wrong-expectation',
    fixture: 'labels-fixed',
    contract: 'label-wrong-expectation.mjs',
    expectedOutcome: 'FAIL',
  },
  {
    caseName: 'broken-export-operation',
    fixture: 'labels-broken-export',
    contract: 'label-operation.mjs',
    expectedOutcome: 'FAIL',
  },
  {
    caseName: 'tally-operation',
    fixture: 'tally',
    contract: 'tally-operation.mjs',
    expectedOutcome: 'PASS',
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const parsed = parseCliArgs(process.argv);

  if (parsed.error) {
    process.stderr.write(`packproof: ${parsed.error}\n\n${HELP}\n`);
    process.exit(1);
  }

  const { values } = parsed;

  if (values.help) {
    process.stdout.write(HELP + '\n');
    process.exit(0);
  }

  if (values.demo) {
    return runDemo(values);
  }

  // Single-case mode
  if (!values.fixture || !values.contract || !values.out) {
    process.stderr.write(
      'packproof: --fixture, --contract and --out are all required for a single run.\n\n' +
      HELP + '\n'
    );
    process.exit(1);
  }

  const fixtureDir = resolve(values.fixture);
  const contractFile = resolve(values.contract);
  const outDir = resolve(values.out);
  const timeoutMs = values.timeout ? parseInt(values.timeout, 10) : DEFAULT_TIMEOUT_MS;

  if (!existsSync(fixtureDir)) {
    process.stderr.write(`packproof: fixture directory not found: ${fixtureDir}\n`);
    process.exit(1);
  }
  if (!existsSync(contractFile)) {
    process.stderr.write(`packproof: contract file not found: ${contractFile}\n`);
    process.exit(1);
  }
  if (isNaN(timeoutMs) || timeoutMs <= 0) {
    process.stderr.write(`packproof: --timeout must be a positive integer, got: ${values.timeout}\n`);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });

  const result = runCase({
    fixtureDir,
    contractFile,
    runDir: outDir,
    caseName: values.case,
    timeoutMs,
  });

  printSummaryLine(result.report.caseName, result.outcome, result.reason, result.reportPath);

  process.exit(result.outcome === 'PASS' ? 0 : 1);
}

function runDemo(values) {
  const fixturesRoot = join(PROJECT_ROOT, 'validation-fixtures');
  const contractsDir = join(fixturesRoot, 'contracts');

  if (!existsSync(fixturesRoot)) {
    process.stderr.write(
      `packproof --demo: validation-fixtures directory not found at ${fixturesRoot}\n` +
      'Run from the project root or check that the fixture packages exist.\n'
    );
    process.exit(1);
  }

  const baseOutDir = values.out
    ? resolve(values.out)
    : join(PROJECT_ROOT, 'runs', `demo-${datestamp()}`);

  process.stdout.write(`PackProof demo — writing artifacts to ${baseOutDir}\n\n`);

  let exitCode = 0;
  const summary = [];

  for (const c of DEMO_CASES) {
    const fixtureDir = join(fixturesRoot, c.fixture);
    const contractFile = join(contractsDir, c.contract);
    const runDir = join(baseOutDir, c.caseName);

    process.stdout.write(`  Running: ${c.caseName} …`);

    let result;
    try {
      result = runCase({
        fixtureDir,
        contractFile,
        runDir,
        caseName: c.caseName,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    } catch (err) {
      process.stdout.write(' ERROR\n');
      process.stderr.write(`    ${err.message}\n`);
      exitCode = 1;
      summary.push({ caseName: c.caseName, outcome: 'INCONCLUSIVE', observedAsExpected: false });
      continue;
    }

    const observedAsExpected = result.outcome === c.expectedOutcome;
    if (!observedAsExpected) exitCode = 1;

    const marker = outcomeMarker(result.outcome);
    process.stdout.write(
      ` ${marker}\n    ${result.outcome}: ${result.reason}\n` +
      `    Report: ${result.reportPath}\n`
    );

    summary.push({
      caseName: c.caseName,
      outcome: result.outcome,
      expectedOutcome: c.expectedOutcome,
      observedAsExpected,
    });
  }

  process.stdout.write('\n── Summary ─────────────────────────────────────────────\n');
  for (const s of summary) {
    const marker = s.observedAsExpected ? '✓' : '✗';
    process.stdout.write(
      `  ${marker}  ${s.caseName.padEnd(34)} ${s.outcome} (expected ${s.expectedOutcome})\n`
    );
  }
  process.stdout.write('\n');

  if (exitCode !== 0) {
    process.stdout.write(
      'One or more cases did not match their expected outcome.\n' +
      'Inspect the JSON reports above for details.\n'
    );
  } else {
    process.stdout.write('All cases matched their expected outcome.\n');
  }

  process.exit(exitCode);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printSummaryLine(caseName, outcome, reason, reportPath) {
  const marker = outcomeMarker(outcome);
  process.stdout.write(`${marker} ${caseName}: ${outcome} — ${reason}\nReport: ${reportPath}\n`);
}

function outcomeMarker(outcome) {
  if (outcome === 'PASS') return '✓';
  if (outcome === 'FAIL') return '✗';
  return '?';
}

function datestamp() {
  return new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
}

main();
