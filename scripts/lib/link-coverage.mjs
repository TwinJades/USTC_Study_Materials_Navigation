/**
 * 外链健康覆盖：将 data/monitoring.json 的检查记录投影到站点实际引用的 URL。
 *
 * 构建报告、来源页与离线校验共用本模块口径：
 * - 统计分母为站点引用的 URL（资料入口与来源主页），而非监控文件总行数；
 * - 监控文件中未被引用的条目记为历史条目，单列而不计入统计；
 * - 无监控记录的 URL 记为「从未检查」，未收到 HTTP 响应不可判为「可访问」。
 */
import {
  HEALTH_EVIDENCE_LABELS,
  summarizeHealth,
} from '../../site/assets/health-evidence.mjs';

const EVIDENCE_ORDER = ['responded', 'auth', 'missing', 'no_response', 'preflight', 'unchecked'];

/** 只保留可解析的 http / https URL，用于对齐监控记录。 */
export function normalizedHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** 监控记录按原始 URL 与规范化 URL 双向索引。 */
export function monitoringLinkMap(dataset) {
  const map = new Map();
  for (const link of dataset.monitoring?.links ?? []) {
    if (!link || typeof link.url !== 'string') continue;
    map.set(link.url, link);
    const normalized = normalizedHttpUrl(link.url);
    if (normalized && normalized !== link.url) map.set(normalized, link);
  }
  return map;
}

/** 站点实际引用的 URL：资料位置（页面 / 下载页 / 直链）与来源主页。 */
function siteUrlUniverse(dataset) {
  const urls = new Set();
  for (const resource of dataset.resources) {
    for (const location of resource.locations ?? []) {
      for (const url of [location.page_url, location.download_page, location.download_url]) {
        if (url) urls.add(url);
      }
    }
  }
  for (const source of dataset.sources) {
    if (source.url) urls.add(source.url);
  }
  return urls;
}

/**
 * 覆盖与证据汇总：证据分类计数 + 统计范围（引用 / 已监控 / 未监控 / 历史条目）+ 预检结论。
 * 每个引用 URL 按监控记录归入单一类别，六类合计等于引用总数。
 */
export function summarizeLinkCoverage(dataset) {
  const universe = siteUrlUniverse(dataset);
  const monitoringLinks = monitoringLinkMap(dataset);
  const monitoredEntries = [];
  let monitored = 0;
  for (const url of [...universe].sort()) {
    const entry = monitoringLinks.get(url) ?? monitoringLinks.get(normalizedHttpUrl(url)) ?? null;
    if (entry) monitored += 1;
    monitoredEntries.push(entry);
  }
  let stale = 0;
  for (const link of dataset.monitoring?.links ?? []) {
    if (!link || typeof link.url !== 'string') continue;
    if (universe.has(link.url)) continue;
    const normalized = normalizedHttpUrl(link.url);
    if (normalized && universe.has(normalized)) continue;
    stale += 1;
  }
  const summary = summarizeHealth(monitoredEntries);
  return {
    ...summary,
    universe: universe.size,
    monitored,
    unmonitored: universe.size - monitored,
    stale,
    checkedAt: dataset.monitoring?.checked_at ?? null,
    // 所有已监控 URL 均停在 DNS / 私网地址预检且无任何 HTTP 响应，说明本次未发出任何外部请求。
    preflightOnly:
      monitored > 0 &&
      summary.preflight === monitored &&
      (summary.httpResponses ?? 0) === 0 &&
      (summary.no_response ?? 0) === 0,
  };
}

/** 按互斥六类输出计数大于 0 的状态摘要。 */
export function healthCountsText(health) {
  const parts = [];
  for (const key of EVIDENCE_ORDER) {
    const n = health?.[key] ?? 0;
    if (n > 0) parts.push(`${HEALTH_EVIDENCE_LABELS[key]} ${n} 条`);
  }
  return parts.length > 0 ? parts.join('、') : '暂无记录';
}

/** 检查范围说明；includeStale 仅用于后台校验输出历史条目数。 */
export function healthScopeText(health, { includeStale = false } = {}) {
  const base =
    health.monitored === health.universe
      ? `全站 ${health.universe} 条外链均有巡检记录`
      : `全站共 ${health.universe} 条外链，其中 ${health.monitored} 条有巡检记录`;
  if (includeStale && health.stale > 0) {
    return `${base}；另有 ${health.stale} 条历史监控记录`;
  }
  return base;
}

/** 环境与异常巡检提示。 */
export function healthEvidenceNotes(health) {
  const notes = [];
  if (health.preflightOnly) {
    notes.push('本次巡检受运行环境网络限制，未能发出外部请求，结果待下次巡检更新。');
  } else if ((health.httpResponses ?? 0) === 0 && (health.no_response ?? 0) > 0) {
    notes.push('本次巡检因连接超时或网络中断未获响应，外链可用性请以直接访问为准。');
  }
  if (health.unmonitored > 0 && health.monitored > 0) {
    notes.push(`另有 ${health.unmonitored} 条新增外链待下次定时巡检纳入。`);
  }
  return notes;
}

export const HEALTH_METHOD_NOTE =
  '定时巡检通过匿名请求记录外链访问状态：收到 HTTP 响应记为「已响应」，需要登录或返回 401/403 记为「需登录或认证」，确认返回 404/410 记为失效。';
