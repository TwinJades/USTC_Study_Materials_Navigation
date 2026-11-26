import { isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openVisitStats(filename) {
  if (!filename || !isAbsolute(filename)) throw new Error('YEXI_STATS_DB 必须是持久数据库的绝对路径');
  const db = new DatabaseSync(filename);
  db.exec(`CREATE TABLE IF NOT EXISTS daily_visits (
    day TEXT PRIMARY KEY, views INTEGER NOT NULL
  ) STRICT`);
  const increment = db.prepare(`INSERT INTO daily_visits (day, views) VALUES (?, 1)
    ON CONFLICT (day) DO UPDATE SET views = views + 1`);
  const readCounts = db.prepare(`SELECT
    COALESCE(MAX(CASE WHEN day = ? THEN views END), CASE WHEN MIN(day) < ? THEN 0 END) AS yesterday,
    SUM(views) AS total FROM daily_visits`);

  return {
    record(req, res) {
      res.setHeader('cache-control', 'no-store');
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' }).end();
        return;
      }
      if (req.headers['sec-fetch-site'] !== 'same-origin' || req.headers['x-yexi-visit'] !== '1') {
        res.writeHead(403).end();
        return;
      }
      if (req.headers['transfer-encoding'] || (req.headers['content-length'] ?? '0') !== '0') {
        res.writeHead(400, { connection: 'close' }).end();
        return;
      }
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      now.setUTCDate(now.getUTCDate() - 1);
      const yesterday = now.toISOString().slice(0, 10);
      increment.run(today);
      const counts = readCounts.get(yesterday, yesterday);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' });
      res.end(JSON.stringify({
        site_views_yesterday: counts.yesterday,
        site_views_date_utc: yesterday,
        site_total_views: counts.total,
      }));
    },
    close: () => db.close(),
  };
}
