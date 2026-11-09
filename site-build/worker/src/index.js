// =============================================================
// eea-releases Worker：GitHub/Gitee Releases 归一化 API
// - 端点：GET /releases（归一化 payload）、GET /health
// - 缓存：Cache API，15min 新鲜 / 24h 可过期（上游失败时返回 STALE）
// - 上游：api.github.com 优先；Cloudflare 出口 IP 常被 GitHub 匿名
//   REST 限流拒绝（403，实测 2026-11-08），失败时改用 ungh.cc
//   （GitHub 无鉴权镜像社区件）产出同一 raw 形状后再归一化。
// - Gitee 抓取失败不阻断主流程，仅损失镜像可用性标注
// - 503 错误体附带上游诊断（状态码 + 速率头 + 响应片段），便于排障
// =============================================================

import { buildPayload } from './releases.js';

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/232252/education-advisor/releases?per_page=100';
const UNGH_RELEASES_URL =
  'https://ungh.cc/repos/232252/education-advisor/releases';
const RELEASE_PAGE_BASE = 'https://github.com/232252/education-advisor/releases/tag/';
const GITEE_RELEASES_URL =
  'https://gitee.com/api/v5/repos/qdzwwqd/education-advisor/releases';

const FRESH_TTL_MS = 15 * 60 * 1000;
const STALE_TTL_MS = 24 * 60 * 60 * 1000;

// Cache API 的 key 用合成 URL：当前 Worker 只有一个数据端点，无需按查询串分流
const CACHE_KEY = new Request('https://cache.internal/eea-releases/releases');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data, { status = 200, cacheStatus } = {}) {
  const headers = {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=60, s-maxage=900, stale-while-revalidate=86400',
  };
  if (cacheStatus) headers['X-Cache'] = cacheStatus;
  return new Response(JSON.stringify(data), { status, headers });
}

/**
 * 拉取上游并解析 JSON。失败时抛出的 Error 携带：
 * 状态码、X-RateLimit-Remaining（若上游提供）与响应体前 300 字符。
 * 日志留痕：匿名 403 的差异（限流 vs IP 段封禁）从这些信息可以直接判读。
 */
async function fetchUpstream(url, env, { ua } = {}) {
  const headers = {
    // Gitee 对数据中心 IP + 非浏览器 UA 有拦截（实测 2026-11-08），
    // 需要 UA 拟真才放行；GitHub 只要求 UA 非空。
    'User-Agent': ua || 'eea-releases-worker',
    Accept: 'application/vnd.github.v3+json',
  };
  // GitHub 匿名限额 60 次/小时/IP；若未来注入 token 则自动带上
  if (env && env.GITHUB_TOKEN && url.includes('api.github.com')) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, { headers });
  if (res.ok) return res.json();
  const text = await res.text().catch(() => '');
  const remaining = res.headers.get('X-RateLimit-Remaining');
  const detail = text.length > 300 ? `${text.slice(0, 300)}…` : text;
  throw new Error(
    `upstream ${res.status}${remaining !== null ? ` (X-RateLimit-Remaining=${remaining})` : ''}: ${detail || '(empty body)'}`,
  );
}

/** ungh.cc release → GitHub REST API 形状（只覆盖本 Worker 用到的字段） */
async function fetchReleases(env) {
  try {
    return await fetchUpstream(GITHUB_RELEASES_URL, env);
  } catch (githubErr) {
    try {
      const ungh = await fetchUpstream(UNGH_RELEASES_URL, null);
      return ungh.releases.filter((r) => !r.draft).map((r) => ({
        tag_name: r.tag,
        prerelease: Boolean(r.prerelease),
        published_at: r.publishedAt,
        html_url: `${RELEASE_PAGE_BASE}${encodeURIComponent(r.tag)}`,
        body: r.markdown || '',
        assets: (r.assets || []).map((a) => {
          const name = decodeURIComponent(a.downloadUrl.split('/').pop() || '');
          return { name, size: a.size, browser_download_url: a.downloadUrl };
        }),
      }));
    } catch (unghErr) {
      throw new Error(`github failed: ${githubErr.message}; ungh fallback failed: ${unghErr.message}`);
    }
  }
}

async function readCacheEntry() {
  const cached = await caches.default.match(CACHE_KEY);
  if (!cached) return null;
  try {
    return await cached.json();
  } catch {
    return null;
  }
}

async function handleReleases(env, ctx) {
  const entry = await readCacheEntry();
  let stale = null;
  if (entry && typeof entry.ts === 'number') {
    const age = Date.now() - entry.ts;
    if (age <= FRESH_TTL_MS) return jsonResponse(entry.data, { cacheStatus: 'HIT' });
    if (age <= STALE_TTL_MS) stale = entry;
  }

  let githubReleases;
  try {
    githubReleases = await fetchReleases(env);
  } catch (err) {
    if (stale) return jsonResponse(stale.data, { cacheStatus: 'STALE' });
    return jsonResponse({ error: `upstream failed: ${err.message}` }, { status: 503 });
  }

  let giteeReleases = null;
  try {
    giteeReleases = await fetchUpstream(GITEE_RELEASES_URL, null, {
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    if (!Array.isArray(giteeReleases)) giteeReleases = null;
  } catch {
    // Gitee 失败不阻断主流程
  }

  const data = buildPayload(githubReleases, giteeReleases);
  const fresh = { ts: Date.now(), data };
  ctx.waitUntil(
    caches.default.put(
      CACHE_KEY,
      new Response(JSON.stringify(fresh), { headers: { 'Content-Type': 'application/json' } }),
    ),
  );
  return jsonResponse(data, { cacheStatus: 'MISS' });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'method not allowed' }, { status: 405 });
    }

    if (pathname === '/releases') return handleReleases(env, ctx);

    if (pathname === '/health') {
      const entry = await readCacheEntry();
      return jsonResponse({
        ok: true,
        updatedAt: entry && entry.data ? entry.data.updatedAt : null,
        cacheStatus: entry ? 'warm' : 'cold',
      });
    }

    return jsonResponse({ error: 'not found' }, { status: 404 });
  },
};
