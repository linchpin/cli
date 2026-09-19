/**
 * Turn a cli-agent-lint JSON report into a summary, and fail if the score sits
 * below the recorded floor.
 *
 * Shared deliberately: `.github/workflows/ci.yml` and `scripts/preflight.sh`
 * both run this, so a preflight cannot disagree with the gate it is previewing.
 *
 *   node scripts/agent-lint-report.mjs <report.json>
 *
 * Reads CLI_AGENT_LINT_MIN_SCORE for the floor, and appends to
 * GITHUB_STEP_SUMMARY when it is running inside Actions.
 */
import { appendFileSync, readFileSync } from 'node:fs';

const reportPath = process.argv[2];

if (!reportPath) {
  console.error('usage: node scripts/agent-lint-report.mjs <report.json>');
  process.exit(2);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const score = report.score.percentage;
const grade = report.score.grade;
const min = Number(process.env.CLI_AGENT_LINT_MIN_SCORE);
const { pass, warn, fail, skip, total } = report.summary;

const attention = report.checks
  .filter((c) => c.status !== 'pass' && c.status !== 'skip')
  .map((c) => `| ${c.id} | ${c.status} | ${c.name.trim()} |`)
  .join('\n');

const summary = [
  `### Agent-readiness: ${score.toFixed(1)}% (grade ${grade})`,
  '',
  `${pass} pass · ${warn} warn · ${fail} fail · ${skip} skip — of ${total}`,
  `Floor: ${min}%`,
  '',
  attention ? '| Check | Status | Name |\n| --- | --- | --- |\n' + attention : 'Nothing needs attention.',
].join('\n');

console.log(summary);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
}

if (score + 1e-9 < min) {
  console.error(
    `\nAgent-readiness regressed: ${score.toFixed(1)}% is below the ${min}% floor.\n` +
      'Fix the regression, or raise the floor deliberately if this is an accepted trade.'
  );
  process.exit(1);
}
