async function reportVisit() {
  const response = await fetch(new URL('../api/visits', import.meta.url), {
    method: 'POST',
    headers: { 'x-yexi-visit': '1' },
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    keepalive: true,
    priority: 'low',
  });
  if (!response.ok) return;
  const stats = await response.json();
  const container = document.getElementById('site-stats');
  if (!container) return;

  for (const key of ['site_views_yesterday', 'site_total_views']) {
    const item = container.querySelector(`[data-stat-item="${key}"]`);
    const value = item?.querySelector('[data-stat-value]');
    if (!value) continue;
    if (key === 'site_views_yesterday') {
      const date = item.querySelector('[data-stat-date]') ?? item.querySelector('dt');
      date.append(` · ${stats.site_views_date_utc}`);
    }
    value.textContent = stats[key]?.toLocaleString('zh-CN') ?? '暂无数据';
    item.hidden = false;
  }
  container.hidden = false;
}

// 模块只在完整文档加载时运行；站内筛选、翻页和 bfcache 恢复不重复计数。
reportVisit().catch(() => {}); // 统计服务故障不影响课程浏览。
