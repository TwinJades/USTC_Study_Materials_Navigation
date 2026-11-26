import { writeFile } from 'node:fs/promises';

const { GITHUB_REPOSITORY, GOATCOUNTER_SITE } = process.env;
const token = process.env.TRAFFIC_TOKEN || process.env.GITHUB_TOKEN;
const collected_at = new Date().toISOString();
const todayUtc = collected_at.slice(0, 10);
const repo_views_date_utc = new Date(Date.parse(`${todayUtc}T00:00:00Z`) - 86_400_000)
  .toISOString().slice(0, 10);
const site_views_date_utc = GOATCOUNTER_SITE ? repo_views_date_utc : null;

async function readStats(label, url, parse, headers) {
  try {
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parse(await response.json());
  } catch (error) {
    console.warn(`无法获取${label}：${error.message}`);
    return null;
  }
}

if (GOATCOUNTER_SITE && !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(GOATCOUNTER_SITE)) {
  throw new Error('GOATCOUNTER_SITE 必须是 GoatCounter 子域名，不能填写完整 URL');
}
if (token && !/^[\w.-]+\/[\w.-]+$/u.test(GITHUB_REPOSITORY ?? '')) {
  throw new Error('GITHUB_REPOSITORY 必须是 owner/repo 格式');
}

const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const goatCount = ({ count: value }) => {
  if (typeof value !== 'string' || !/^(?:\d+|\d{1,3}(?:,\d{3})+)$/u.test(value)) return null;
  return count(Number(value.replaceAll(',', '')));
};
const counter = GOATCOUNTER_SITE ? `https://${GOATCOUNTER_SITE}.goatcounter.com/counter/TOTAL.json` : null;
const countRange = (start, end) => `${counter}?${new URLSearchParams({ start, end })}`;
// TOTAL sums hourly buckets and includes both endpoints. Remove today's 00:00 UTC bucket.
const [repo, site_total_views, throughMidnight, midnight] = await Promise.all([
  token ? readStats('仓库流量', `https://api.github.com/repos/${GITHUB_REPOSITORY}/traffic/views`,
    ({ count: total, views }) => ({
      repo_views_14d: count(total),
      repo_views_yesterday: Array.isArray(views)
        ? count(views.find(({ timestamp }) => timestamp?.slice(0, 10) === repo_views_date_utc)?.count)
        : null,
    }), { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }) : null,
  counter ? readStats('网站累计浏览', counter, goatCount) : null,
  counter ? readStats('网站截至零点浏览', countRange(site_views_date_utc, todayUtc), goatCount) : null,
  counter ? readStats('网站零点小时桶浏览', countRange(todayUtc, todayUtc), goatCount) : null,
]);
const site_views_yesterday = throughMidnight !== null && midnight !== null
  ? count(throughMidnight - midnight)
  : null;

await writeFile('data/traffic.local.json', JSON.stringify({
  repo_views_date_utc, site_views_date_utc, collected_at,
  repo_views_yesterday: repo?.repo_views_yesterday ?? null,
  repo_views_14d: repo?.repo_views_14d ?? null, site_total_views, site_views_yesterday,
}, null, 2) + '\n');
