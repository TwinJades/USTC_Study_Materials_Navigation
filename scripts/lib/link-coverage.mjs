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

/** 证据分类计数文本；六类互斥，httpResponses 与分类计数存在重叠，不可相加。 */
export function healthCountsText(health) {
  const count = (key) => health?.[key] ?? 0;
  const labels = HEALTH_EVIDENCE_LABELS;
  return [
    `收到 HTTP 响应 ${count('httpResponses')} 条（${labels.responded} ${count('responded')}、${labels.auth} ${count('auth')}、${labels.missing} ${count('missing')}）`,
    `${labels.preflight} ${count('preflight')}`,
    `${labels.no_response} ${count('no_response')}`,
    `${labels.unchecked} ${count('unchecked')}`,
  ].join('；');
}

/** 检查范围说明；分类明细由 healthCountsText 输出。 */
export function healthScopeText(health) {
  const stale =
    health.stale > 0 ? `；监控文件另有 ${health.stale} 个未引用的历史条目（不计入统计）` : '';
  return `共引用 ${health.universe} 个 URL，已覆盖 ${health.monitored} 个${stale}`;
}

/** 环境与判定口径说明：无 HTTP 响应时不记作可访问或失效。 */
export function healthEvidenceNotes(health) {
  const notes = [];
  if (health.preflightOnly) {
    notes.push(
      '本次未收到任何 HTTP 响应：已检 URL 均在安全预检阶段未放行，请求未发出，不能据此判定可用或失效。',
    );
  } else if ((health.httpResponses ?? 0) === 0 && (health.no_response ?? 0) > 0) {
    notes.push(
      '本次已发起连接但未收到 HTTP 响应（超时或连接失败），仅反映当次网络状态，不代表资源失效。',
    );
  }
  if (health.unmonitored > 0) {
    notes.push('「从未检查」表示尚无监控记录，不同于「已检查但无法确认」。');
  }
  return notes;
}

export const HEALTH_METHOD_NOTE =
  '仅确认 HTTP 404 / 410 计为失效。需登录或认证说明服务器有响应但须验证身份；目录页、软错误页、超时与预检拦截均不证明文件可下载或失效。重定向前跳已响应而终跳预检未放行者，归入「预检未放行」，同时计入收到 HTTP 响应条目。';
