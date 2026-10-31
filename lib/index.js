/**
 * dsh-token-usage —— 宿主侧。
 *
 * 只做一件事：把会话记录里的 Token 用量聚合出来，通过一条同源路由交给
 * 浏览器半边。同源是关键——宿主进程已经拥有本机文件和网络访问权，页面
 * 直接 fetch 本机路由，就不用牵扯 CORS、CSP 和跨域凭据。
 *
 * ## 为什么请求不阻塞在扫描上
 *
 * 扫描会话目录要几百毫秒（首次全量 ~0.5 秒，之后走增量是毫秒级）。如果
 * 请求同步等扫描，用户点开面板就要等一下才出数字——"点击后加载延迟"。
 *
 * 所以这里用 stale-while-revalidate：
 *   - 插件装载时后台预热一次，用户第一次点开时快照通常已经就绪；
 *   - 快照过期时**先返回旧数据**（立刻出数字），同时在后台重扫；
 *   - 响应头 x-token-usage-stale 告诉浏览器"这是旧快照"，浏览器稍后再取
 *     一次就能拿到刚刷新的数据。
 *
 * 于是点击永远是即时的，数据最多晚一两秒跟上。
 *
 * @module dsh-token-usage
 */

import { scanUsageAsync } from './aggregate.js'

export const name = 'token-usage'

/** 用量数据的路由（GET）。 */
const USAGE_ROUTE = '/dsh-token-usage/usage'

/**
 * 快照多久算"新鲜"。
 *
 * 过期不意味着要同步重扫——只是触发一次后台刷新，并给返回的响应打上
 * stale 标记，让浏览器自己补一次取数。
 */
const CACHE_TTL_MS = 30_000

/** 进程内快照。 */
let cache = null

/** 正在跑的后台刷新（避免并发扫描）。 */
let refreshing = null

/** 冷启动时的空快照：结构齐全、数值为 0。 */
const EMPTY_PAYLOAD = { days: {}, models: [], totalTokens: 0, totalCalls: 0, scannedAt: 0, sessions: 0 }

/**
 * 后台重扫一次，完成后替换快照。
 *
 * 失败时保留旧快照——一次统计失败不该让面板空掉。
 *
 * @returns {Promise<void>}
 */
function refreshInBackground() {
  if (refreshing !== null) return refreshing
  refreshing = scanUsageAsync()
    .then((payload) => {
      cache = { at: Date.now(), payload }
    })
    .catch(() => {
      // 扫描失败：留着旧快照，下个请求再试
    })
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

/**
 * GET /dsh-token-usage/usage -> 用量 JSON
 *
 * 返回结构：
 *   { days: { "YYYY-MM-DD": { "provider/model": { total, input, output, calls } } },
 *     models: string[], totalTokens, totalCalls, scannedAt, sessions }
 *
 * 响应头 x-token-usage-stale: '1' 表示这是过期快照、后台正在重扫。
 */
async function usageHandler(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { allow: 'GET' })
    res.end()
    return
  }
  const now = Date.now()
  const fresh = cache !== null && now - cache.at < CACHE_TTL_MS
  if (!fresh) {
    if (cache === null) {
      // 冷启动（预热还没跑完）：这一次等一下，先给真实数据，别给一堆 0
      await refreshInBackground()
    } else {
      // 有旧快照：先返回旧的，后台重扫
      void refreshInBackground()
    }
  }
  const entry = cache
  const payload = entry === null ? EMPTY_PAYLOAD : entry.payload
  const stale = entry !== null && now - entry.at >= CACHE_TTL_MS
  const body = JSON.stringify(payload)
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-token-usage-stale': stale ? '1' : '0',
  })
  res.end(body)
}

/**
 * 挂载宿主侧。
 *
 * 路由通过可选注入注册（`ctx.inject(['webServer'], …)`），所以一个没有 HTTP
 * 载体的 profile——或者改名过该服务的 profile——不会因为这个插件整个起不来。
 *
 * @param {object} ctx - 插件上下文。
 */
export function apply(ctx) {
  // 预热：插件装载后立刻在后台扫一次，用户第一次点开面板时快照已经就绪
  void refreshInBackground()

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: USAGE_ROUTE,
          handler: usageHandler,
        }),
      `token-usage: GET ${USAGE_ROUTE}`,
    )
  })
}

/** 测试用：清掉进程内快照。 */
export function resetCache() {
  cache = null
  refreshing = null
}
