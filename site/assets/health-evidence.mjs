// 外链健康证据分类：后端监控报告、构建校验与浏览器展示共用的纯函数。
//
// 目的：monitoring.json 的 `status` / `reason` 只有 reachable / missing / unknown，
// 无法说明「到底有没有发出 HTTP 请求」。例如 `unknown/private_host`（DNS 或私网
// 地址预检拦截）与 `unknown/connection_refused`（请求已发出但无响应）含义完全不同。
// 本模块将单条检查记录归入稳定的证据类别：
//
//   unchecked    从未检查，或没有检查记录
//   preflight    URL / DNS / 地址安全预检未放行，未向当前目标发出 HTTP 请求
//   no_response  预检通过、请求已发出，但未收到 HTTP 响应（超时或连接失败）
//   auth         收到 401 / 403，或被识别为登录页 / 统一身份认证
//   missing      确认 404 / 410（唯一可判定「坏链」的类别）
//   responded    收到 HTTP 响应（2xx / 3xx / 429 / 5xx / 软错误页等），不等于文件可下载
//
// 重定向前置跳已收到响应、后续目标被预检拦截时，仍归类为 preflight（最终目标
// 没有可用证据），但 summarizeHealth 的 httpResponses 仍计入该已观察到的响应——
// 分类描述最终结论，httpResponses 描述是否真的收到过响应。
//
// 纯 ESM、无 Node / DOM 依赖，浏览器与 scripts/*.mjs 均可直接 import。

/** 证据类别及其面向用户的说明。顺序即报告展示顺序。 */
export const HEALTH_EVIDENCE_LABELS = {
  unchecked: '从未检查',
  preflight: '预检未放行',
  no_response: '请求无响应',
  auth: '需登录或认证',
  missing: '确认 404/410',
  responded: '已响应',
};

const PREFLIGHT_REASONS = new Set([
  'private_host',
  'invalid_url',
  'unsupported_scheme',
  'credentials_in_url',
  'dns_error',
]);

const NO_RESPONSE_REASONS = new Set([
  'timeout',
  'connection_refused',
  'connection_reset',
  'network_error',
]);

const OBSERVED_RESPONSE_REASONS = new Set([
  'error_page',
  'rate_limited',
  'server_error',
  'redirect_without_location',
  'too_many_redirects',
  'invalid_redirect',
]);

function httpStatusOf(entry) {
  const value = entry?.http_status;
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

/**
 * 把一条 monitoring link 记录归类为单一证据类别。
 * 只认已确认的 HTTP 404/410 为 missing；预检拦截、超时、软错误页都不算坏链。
 */
export function classifyHealth(entry) {
  if (!entry || typeof entry !== 'object') return 'unchecked';

  const status = typeof entry.status === 'string' ? entry.status : '';
  const reason = typeof entry.reason === 'string' ? entry.reason : '';
  const http = httpStatusOf(entry);

  if (status === 'missing' || http === 404 || http === 410) return 'missing';
  if (reason === 'auth_required' || reason === 'login_required' || http === 401 || http === 403) {
    return 'auth';
  }
  if (PREFLIGHT_REASONS.has(reason)) return 'preflight';
  if (NO_RESPONSE_REASONS.has(reason)) return 'no_response';
  if (
    status === 'reachable' ||
    reason === 'ok' ||
    OBSERVED_RESPONSE_REASONS.has(reason) ||
    /^http_\d{3}$/.test(reason) ||
    http !== null
  ) {
    return 'responded';
  }
  if (status === 'unchecked' || !entry.checked_at) return 'unchecked';
  if (status === 'unknown') return 'no_response';
  return 'unchecked';
}

/**
 * 汇总一组检查记录。六个类别互斥且合计为条目总数；
 * `httpResponses` 是「至少收到过一次 HTTP 响应」的条目数（包含 auth、missing
 * 以及重定向前置跳已响应的 preflight/no_response），与类别计数存在重叠，
 * 不应相加当作分母。
 */
export function summarizeHealth(entries) {
  const summary = {
    unchecked: 0,
    preflight: 0,
    no_response: 0,
    auth: 0,
    missing: 0,
    responded: 0,
    httpResponses: 0,
  };
  for (const entry of Array.isArray(entries) ? entries : []) {
    const category = classifyHealth(entry);
    summary[category] += 1;
    if (
      category === 'responded' ||
      category === 'auth' ||
      category === 'missing' ||
      httpStatusOf(entry) !== null
    ) {
      summary.httpResponses += 1;
    }
  }
  return summary;
}
