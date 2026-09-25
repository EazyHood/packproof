#!/usr/bin/env node
/**
 * PackProof CLI
 *
 * Usage:
 *   packproof --fixture <dir> --contract <file> --out <dir> [--timeout <ms>] [--case <name>]
 *   packproof --demo [--out <dir>] [--timeout <ms>]
 *
 * --fixture   Path to the fixture package source directory (must contain package.json)
 * --contract  Path to the consumer contract .mjs file
 * --out       Parent directory where unique run artifact subdirectories are created
 * --timeout   Contract timeout in milliseconds (must be a positive finite integer;
 *             default: 15000)
 * --case      Metadata label for this run (stored in report; does not control paths)
 * --demo      Run the full six-case demo against validation-fixtures/
 * --help      Show this help message
 *
 * Exit codes:
 *   0  All runs produced their expected outcome
 *   1  At least one run did not match, bad input, or missing tool
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
  packproof --demo [--out <dir>] [--timeout <ms>]

Options:
  --fixture  <dir>   Path to fixture package source directory
  --contract <file>  Path to consumer contract .mjs file
  --out      <dir>   Parent directory for run artifact subdirectories
  --timeout  <ms>    Contract timeout (positive integer ms, default: ${DEFAULT_TIMEOUT_MS})
  --case     <name>  Metadata label for this run (stored in report only)
  --demo             Run the full demo against validation-fixtures/
  --help             Show this help

Limitations:
  npm-cli.js is discovered via NPM_EXECPATH, adjacent to node, or lib/node_modules.
  Set NPM_EXECPATH to override. Descendant processes are not killed on timeout.
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

/**
 * Validate --timeout: must be a string of digits only representing a positive
 * finite integer.  parseInt('12oops', 10) returns 12; we reject any non-digit.
 *
 * @param {string|undefined} raw
 * @returns {{ ms: number, error: string }}
 */
function parseTimeout(raw) {
  if (raw === undefined) return { ms: DEFAULT_TIMEOUT_MS, error: '' };
  // Only digits allowed (no leading sign, no decimal, no scientific notation)
  if (!/^\d+$/.test(raw)) {
    return { ms: 0, error: `--timeout must be a positive integer (digits only), got: ${raw}` };
  }
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) {
    return { ms: 0, error: `--timeout must be a positive finite integer, got: ${raw}` };
  }
  return { ms, error: '' };
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

  // Validate --timeout early in all modes
  const { ms: timeoutMs, error: timeoutError } = parseTimeout(values.timeout);
  if (timeoutError) {
    process.stderr.write(`packproof: ${timeoutError}\n`);
    process.exit(1);
  }

  if (values.demo) {
    return runDemo(values, timeoutMs);
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

  if (!existsSync(fixtureDir)) {
    process.stderr.write(`packproof: fixture directory not found: ${fixtureDir}\n`);
    process.exit(1);
  }
  if (!existsSync(contractFile)) {
    process.stderr.write(`packproof: contract file not found: ${contractFile}\n`);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });

  let result;
  try {
    result = runCase({
      fixtureDir,
      contractFile,
      artifactDir: outDir,
      caseName: values.case,
      timeoutMs,
    });
  } catch (err) {
    process.stderr.write(`packproof: ${err.message}\n`);
    process.exit(1);
  }

  printSummaryLine(result.report.caseName, result.outcome, result.reason, result.reportPath);
  process.exit(result.outcome === 'PASS' ? 0 : 1);
}

function runDemo(values, timeoutMs) {
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

  mkdirSync(baseOutDir, { recursive: true });
  process.stdout.write(`PackProof demo — artifact parent: ${baseOutDir}\n\n`);

  let exitCode = 0;
  const summary = [];

  for (const c of DEMO_CASES) {
    const fixtureDir = join(fixturesRoot, c.fixture);
    const contractFile = join(contractsDir, c.contract);

    process.stdout.write(`  Running: ${c.caseName} …`);

    let result;
    try {
      result = runCase({
        fixtureDir,
        contractFile,
        artifactDir: baseOutDir,
        caseName: c.caseName,
        timeoutMs,
        // Only the first case in the demo runs the source baseline to avoid
        // running it six times.  It is linked from the demo summary separately.
        runSourceBaseline: summary.length === 0,
      });
    } catch (err) {
      process.stdout.write(' ERROR\n');
      process.stderr.write(`    ${err.message}\n`);
      exitCode = 1;
      summary.push({ caseName: c.caseName, outcome: 'INCONCLUSIVE', expectedOutcome: c.expectedOutcome, observedAsExpected: false });
      continue;
    }

    const observedAsExpected = result.outcome === c.expectedOutcome;
    if (!observedAsExpected) exitCode = 1;

    const marker = outcomeMarker(result.outcome);
    process.stdout.write(
      ` ${marker}\n    ${result.outcome}: ${result.reason}\n` +
      `    RunDir: ${result.runDir}\n` +
      `    Report: ${result.reportPath}\n`
    );

    summary.push({
      caseName: c.caseName,
      outcome: result.outcome,
      expectedOutcome: c.expectedOutcome,
      observedAsExpected,
      sourceBaseline: summary.length === 0 ? result.report.sourceBaseline : null,
    });
  }

  process.stdout.write('\n── Summary ─────────────────────────────────────────────\n');
  for (const s of summary) {
    const marker = s.observedAsExpected ? '✓' : '✗';
    process.stdout.write(
      `  ${marker}  ${s.caseName.padEnd(34)} ${s.outcome} (expected ${s.expectedOutcome})\n`
    );
  }

  // Print source baseline status (recorded once with the first case)
  const baselineEntry = summary.find((s) => s.sourceBaseline !== null);
  if (baselineEntry?.sourceBaseline) {
    const sb = baselineEntry.sourceBaseline;
    const sbMarker = sb.status === 'pass' ? '✓' : (sb.status === 'not-run' ? '-' : '✗');
    process.stdout.write(
      `\n  Source baseline: ${sbMarker} ${sb.status}` +
      (sb.exit != null ? ` (exit ${sb.exit})` : '') +
      (sb.durationMs != null ? ` ${sb.durationMs}ms` : '') +
      '\n'
    );
    if (sb.status !== 'pass' && sb.status !== 'not-run') {
      process.stdout.write(`    ${sb.reason || ''}\n`);
      exitCode = 1;
    }
  }
  process.stdout.write('\n');

  if (exitCode !== 0) {
    process.stdout.write(
      'One or more cases did not match their expected outcome.\n' +
      'Inspect the run directories shown above for details.\n'
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
