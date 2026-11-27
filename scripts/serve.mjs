#!/usr/bin/env node
/**
 * 本地静态服务器：仅绑定 127.0.0.1:4173，服务 dist/。
 * - 拒绝 .. 路径段、反斜杠、空字节和指向 dist 之外的符号链接；
 * - 只允许 GET/HEAD；
 * - 不列目录，无 SPA 回退。
 */
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openVisitStats } from './lib/visit-stats.mjs';

const HOST = '127.0.0.1';
const isVlab = process.argv.includes('--vlab');
const PORT = isVlab ? Number(process.env.YEXI_VLAB_PORT ?? 8080) : 4173;
const DIST_DIR = path.resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const visitStats = isVlab ? openVisitStats(process.env.YEXI_STATS_DB) : null;

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.jsonl', 'application/x-ndjson; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.woff2', 'font/woff2'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
]);

function sendText(res, status, message, extraHeaders = {}) {
  const body = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${status}</title><p>${message}</p></html>`;
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

/** 将请求路径解析为 dist/ 内的绝对路径；非法或越界路径返回 { error: 400 | 403 }。 */
function resolveRequestPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { error: 400 };
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return { error: 400 };

  const segments = decoded.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.some((segment) => segment === '..')) return { error: 403 };

  const relative = segments.join('/');
  const absolute = path.resolve(DIST_DIR, relative);
  if (absolute !== DIST_DIR && !absolute.startsWith(DIST_DIR + path.sep)) {
    return { error: 403 };
  }
  return { absolute, trailingSlash: decoded.endsWith('/') };
}

async function handleRequest(req, res) {
  if (visitStats && req.url === '/api/visits') {
    await visitStats.record(req, res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, '只支持 GET 与 HEAD 请求。', { allow: 'GET, HEAD' });
    return;
  }

  let requestUrl;
  try {
    requestUrl = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  } catch {
    sendText(res, 400, '请求地址无法解析。');
    return;
  }

  const resolved = resolveRequestPath((req.url ?? '/').split('?')[0]);
  if (resolved.error === 400) {
    sendText(res, 400, '请求路径编码或字符不合法。');
    return;
  }
  if (resolved.error === 403) {
    sendText(res, 403, '请求路径超出站点目录。');
    return;
  }

  let target = resolved.absolute;
  let info;
  try {
    info = await stat(target);
    if (info.isDirectory()) {
      if (!resolved.trailingSlash) {
        res.writeHead(301, {
          location: `${requestUrl.pathname}/${requestUrl.search}`,
          'cache-control': 'no-store',
        });
        res.end();
        return;
      }
      target = path.join(target, 'index.html');
      info = await stat(target);
    }
    if (!info.isFile()) {
      sendText(res, 404, '未找到请求的文件。');
      return;
    }
  } catch {
    sendText(res, 404, '未找到请求的文件。<a href="/">返回课程目录</a>');
    return;
  }

  // 符号链接解析后再确认仍在 dist 内。
  let realTarget;
  try {
    realTarget = await realpath(target);
    const realDist = await realpath(DIST_DIR);
    if (realTarget !== realDist && !realTarget.startsWith(realDist + path.sep)) {
      sendText(res, 403, '请求路径超出站点目录。');
      return;
    }
  } catch {
    sendText(res, 404, '未找到请求的文件。');
    return;
  }

  const extension = path.extname(realTarget).toLowerCase();
  const headers = {
    'content-type': MIME_TYPES.get(extension) ?? 'application/octet-stream',
    'content-length': info.size,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'cache-control': 'no-cache',
  };

  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(realTarget);
  stream.on('error', () => {
    if (!res.headersSent) sendText(res, 500, '读取文件失败。');
    else res.destroy();
  });
  stream.pipe(res);
}

const server = createServer((req, res) => {
  handleRequest(req, res)
    .catch((error) => {
      console.error('请求处理失败：', error);
      if (!res.headersSent) sendText(res, 500, '服务器内部错误。');
      else res.destroy();
    });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，请先停止占用该端口的进程。`);
  } else {
    console.error('本地服务器启动失败：', error);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`${isVlab ? 'vLab' : '本地预览'}：http://${HOST}:${server.address().port}/（服务目录 dist/）`);
  if (!isVlab) console.log('按 Ctrl+C 停止。');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\n正在关闭本地服务器…');
    server.close(() => {
      visitStats?.close();
      process.exitCode = 0;
    });
  });
}