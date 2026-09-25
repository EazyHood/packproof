// Presentation support by Codex. Export saved records without local user paths.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const summaryPath = process.argv[2];
if (!summaryPath) throw new Error('Usage: node scripts/export-viewer.mjs <demo-summary.json> [output.json]');
const summary = JSON.parse(readFileSync(resolve(summaryPath), 'utf8').replace(/^\uFEFF/, ''));
if (summary.schema !== 'packproof-demo-v1' || !Array.isArray(summary.cases)) throw new Error('A saved PackProof demo summary is required');
const reports = summary.cases.map(entry => {
  if (!entry.reportPath) throw new Error(`Missing saved report for ${entry.caseName}`);
  const report = JSON.parse(readFileSync(entry.reportPath, 'utf8').replace(/^\uFEFF/, ''));
  if (report.caseName !== entry.caseName || report.result.outcome !== entry.outcome) throw new Error('Summary/report mismatch');
  return { ...report, expectedOutcome: entry.expectedOutcome };
});
function redact(value) {
  if (typeof value === 'string') return value
    .replaceAll(project, '<PROJECT>').replaceAll(project.replaceAll('\\', '/'), '<PROJECT>')
    .replace(/C:[\\/]+Users[\\/]+[^\\/\s"']+/gi, '<USER>');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
  return value;
}
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8', windowsHide: true });
const bundle = redact({
  generatedAt: new Date().toISOString(),
  sourceCommit: git.status === 0 ? git.stdout.trim() : 'unknown',
  sourceBaseline: summary.sourceBaseline,
  reports,
  evidenceNote: 'Saved local Windows executions. Host paths redacted for sharing; outputs, outcomes and artifact hashes retained. These records are not browser executions, independent attestations or signatures.',
  validated: summary.validated,
});
const output = resolve(process.argv[3] ?? join(project, 'viewer/data.json'));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(bundle, null, 2) + '\n');
console.log(`Exported ${reports.length} authentic saved reports to ${output}`);
