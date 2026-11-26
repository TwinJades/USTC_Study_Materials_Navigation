#!/usr/bin/env node
/**
 * 离线校验课程、元数据、标签、资料、来源、检索日志与监控数据。
 * 只读离线校验。
 */

import {
  RESOURCE_TYPE_LABELS,
  formatIssue,
  loadRepository,
  validateRepository,
} from './lib/data.mjs';
import {
  healthCountsText,
  healthEvidenceNotes,
  healthScopeText,
  summarizeLinkCoverage,
} from './lib/link-coverage.mjs';

const args = new Set(process.argv.slice(2));

if (args.has('--help') || args.has('-h')) {
  console.log(`用法：npm run validate [-- [--strict-research] [--require-monitoring]]

  --strict-research     每门课程缺少 GitHub、评课社区与公开网页三路径检索记录时判为错误
  --require-monitoring  要求 data/monitoring.json 已生成

默认将三路径缺口记为警告；结构、引用、枚举或必填项问题均判为失败。`);
  process.exit(0);
}

const options = {
  requireResearchCoverage: args.has('--strict-research'),
  requireMonitoring: args.has('--require-monitoring'),
};

let dataset;
try {
  dataset = loadRepository();
} catch (error) {
  console.error(`无法加载数据：${error?.message ?? error}`);
  process.exitCode = 1;
  process.exit();
}

const result = validateRepository(dataset, options);
const { errors, warnings, stats } = result;

for (const issue of errors) {
  console.error(formatIssue(issue));
}
for (const issue of warnings) {
  console.warn(formatIssue(issue));
}

const kinds = stats.courses.kinds;
const resources = stats.resources;
const research = stats.researchLog;
const coverage = research.coverage;
const monitoring = stats.monitoring;

console.log('');
console.log(`课程：${stats.courses.total} 门；已收录资料 ${stats.courses.withResources} 门，暂未收录 ${stats.courses.withoutResources} 门`);
console.log(
  `分类：通修课 ${kinds.common} / 通识课 ${kinds.general} / 专业课 ${kinds.professional}`,
);
console.log(
  `资料：${resources.total} 条（${Object.entries(resources.byType)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${RESOURCE_TYPE_LABELS[type]} ${count}`)
    .join('、') || '无'}）`,
);
if (monitoring.present) {
  // 统计分母是站点引用的网址；未监控、预检未放行与已响应必须分开表述。
  const health = summarizeLinkCoverage(dataset);
  console.log(`外链：${healthScopeText(health, { includeStale: true })}`);
  console.log(`  证据：${healthCountsText(health)}`);
  for (const note of healthEvidenceNotes(health)) console.log(`  ${note}`);
} else {
  console.log('外链：尚未生成 data/monitoring.json，本次离线校验不含外链巡检结果');
}

if (!coverage.complete) {
  const sample = coverage.missingSample
    .map((course) => `${course.code}（缺 ${course.missing.join('、')}）`)
    .join('、');
  console.log(`三路径缺口：${coverage.missingCount} 门；示例：${sample}`);
}
if (coverage.blockedOnly.length) {
  console.log(`三路径均受阻：${coverage.blockedOnly.length} 门`);
}


console.log('');
if (errors.length) {
  console.error(`校验失败：${errors.length} 项错误，${warnings.length} 项警告。`);
  process.exitCode = 1;
} else {
  console.log(`校验通过：0 项错误，${warnings.length} 项警告。`);
}
