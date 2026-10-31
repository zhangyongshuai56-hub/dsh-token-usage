/**
 * 从 DSH 会话记录里聚合 Token 用量。
 *
 * DSH 没有现成的按模型 token 台账：每条模型响应把用量写进会话文件的
 * `assistant/message` 事件（usage: inputTokens / outputTokens /
 * cacheReadTokens / cacheWriteTokens / totalTokens），模型归属在同一会话的
 * `request/header`（config.provider / config.model）里。所以这里是读取会话
 * 文件、按本地时区归日、按 provider/model 聚合。
 *
 * ## 为什么是增量的
 *
 * 会话文件是**追加写**的：每次落盘都追加一个完整的 zstd 帧。所以一个文件的
 * 字节内容只增不改，历史部分的聚合结果也就永远不变。
 *
 * 全量扫描在这台机器上要 0.7 秒（40 个会话文件 / 38 MB / 1.9 万个 zstd 帧），
 * 而这 0.7 秒是压在"用户点开面板"那一次请求上的——表现为点击后要等一下才出
 * 数字。
 *
 * 所以这里按文件记住"已经消费到第几个字节 + 截至该处的聚合结果"，再次扫描
 * 时只解压新增的那几帧。稳态下（文件没变）整轮扫描只是几十次 stat，毫秒级；
 * 只有当前会话在增长时才会解一点新数据。
 *
 * @module dsh-token-usage/aggregate
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** 会话文件在 ~/.dsh/sessions 下，工作区名 → 会话目录 → session.v4.jsonl.zstd。 */
const SESSION_FILE = 'session.v4.jsonl.zstd'

/** 文件指纹长度：头 16 字节 + 已消费区尾部 32 字节。用来发现"文件被改写"。 */
const HEAD_BYTES = 16
const TAIL_BYTES = 32

/**
 * 事件类型预筛。
 *
 * 会话日志里 85% 的行是用户消息、工具结果、推理片段，跟统计无关。先用一次
 * 正则挑出可能相关的行，再交给 JSON.parse，能省掉大部分解析开销。
 */
const RELEVANT = /"(?:assistant\/message|request\/header|request\/context)"/

/**
 * 每文件的增量状态。
 *
 * @typedef {{
 *   size: number,
 *   mtimeMs: number,
 *   consumed: number,
 *   head: string,
 *   tail: string,
 *   provider: string | null,
 *   model: string | null,
 *   map: Map<string, { total: number, input: number, output: number, calls: number }>,
 * }} FileState
 */

/** @type {Map<string, FileState>} */
const fileStates = new Map()

/** 会话根目录：优先 DSH 会话目录环境变量，其次 ~/.dsh/sessions。 */
export function sessionsRoot() {
  const fromEnv = process.env.DSH_SESSIONS_DIR
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return join(homedir(), '.dsh', 'sessions')
}

/**
 * 解开一个 zstd 文件的全部帧。
 *
 * 会话日志是**追加写**的：每次落盘都追加一个完整的 zstd 帧，所以文件里有
 * 多帧。Node 的 zstdDecompressSync 只解第一帧，遇到非法数据会抛，所以这里
 * 按帧头魔数（0x28 0xB5 0x2F 0xFD）逐帧推进。
 *
 * @param {Buffer} raw - 文件内容。
 * @param {number} start - 从第几个字节开始解（增量扫描时不为 0）。
 * @returns {{ text: string, consumed: number }} 解出来的文本 + 已消费的字节数。
 */
function decodeFrames(raw, start) {
  const chunks = []
  let offset = start
  let consumed = start
  while (offset < raw.length) {
    const next = findNextFrame(raw, offset + 1)
    let frame = null
    // 优先按"恰好一帧"的切片解：解码器不用去扫后面的垃圾数据
    if (next > offset) {
      try {
        frame = zstdDecompressSync(raw.subarray(offset, next))
      } catch {
        frame = null
      }
    }
    if (frame === null) {
      // 退回整段：解第一帧（尾部若是不完整的帧会抛错，交给下面 break）
      try {
        frame = zstdDecompressSync(raw.subarray(offset))
      } catch {
        break
      }
    }
    chunks.push(frame)
    if (next <= offset) {
      consumed = raw.length
      break
    }
    offset = next
    consumed = next
  }
  return { text: Buffer.concat(chunks).toString('utf8'), consumed }
}

/** 下一个 zstd 帧头的位置；找不到就返回 -1。 */
function findNextFrame(raw, from) {
  for (let index = from; index < raw.length - 4; index += 1) {
    if (raw[index] === 0x28 && raw[index + 1] === 0xb5 && raw[index + 2] === 0x2f && raw[index + 3] === 0xfd) {
      return index
    }
  }
  return -1
}

/** 本地时区的 YYYY-MM-DD。会话时间戳是 epoch，跨时区聚合必须用本地日界。 */
function localDay(epochMs) {
  const date = new Date(epochMs)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 递归收集所有会话文件路径。 */
function collectSessionFiles(root, out = []) {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      collectSessionFiles(full, out)
    } else if (entry.name === SESSION_FILE) {
      out.push(full)
    }
  }
  return out
}

/** 空的单文件状态。 */
function newState() {
  return { size: 0, mtimeMs: 0, consumed: 0, head: '', tail: '', provider: null, model: null, map: new Map() }
}

/**
 * 把一段会话文本并进状态。
 *
 * @param {FileState} state - 单文件状态（provider/model 会跨增量保留）。
 * @param {string} text - 本次解出来的 JSONL 文本。
 * @param {boolean} filtered - 是否先做事件类型预筛。
 */
function parseInto(state, text, filtered) {
  const lines = text.split('\n')
  let parsed = 0
  for (const line of lines) {
    if (line.length === 0) continue
    if (filtered && !RELEVANT.test(line)) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event === null || typeof event !== 'object') continue
    parsed += 1
    const type = event.type
    if (type === 'request/header') {
      const config = event.data?.header?.config
      if (config?.model) {
        state.model = String(config.model)
        state.provider = config.provider ? String(config.provider) : state.provider
      }
    } else if (type === 'request/context') {
      if (event.data?.model) state.model = String(event.data.model)
      if (event.data?.provider) state.provider = String(event.data.provider)
    } else if (type === 'assistant/message') {
      const usage = event.data?.usage
      if (usage === undefined || usage === null || typeof event.time !== 'number') continue
      if (state.model === null) continue
      const key = `${state.provider ?? '?'}/${state.model}`
      const day = localDay(event.time)
      const mapKey = `${day}\u0000${key}`
      const bucket = state.map.get(mapKey) ?? { total: 0, input: 0, output: 0, calls: 0 }
      const total = Number(usage.totalTokens ?? 0)
      bucket.total += total
      bucket.input += Number(usage.inputTokens ?? 0)
      bucket.output += Number(usage.outputTokens ?? 0)
      bucket.calls += 1
      state.map.set(mapKey, bucket)
    }
  }
  // 兜底：预筛后一条都没解析出来，但文本里明明有内容 → 日志格式可能变了
  // （比如 type 字段写法变了），退回逐行全解析，宁可慢也不能算错。
  if (filtered && parsed === 0 && lines.length > 1) parseInto(state, text, false)
}

/** 取一段字节的十六进制指纹。 */
function fingerprint(raw, from, length) {
  if (length <= 0) return ''
  const start = Math.max(0, from)
  const end = Math.min(raw.length, start + length)
  if (end <= start) return ''
  return raw.subarray(start, end).toString('hex')
}

/**
 * 扫一遍会话目录，返回按天 × 按模型的用量。
 *
 * 这是生成器版本：需要让出事件循环时 yield 一下，宿主侧用异步驱动（扫描
 * 期间不卡住整个进程），测试侧同步跑完。
 *
 * @yields {void}
 * @returns {{
 *   days: Record<string, Record<string, { total: number, input: number, output: number, calls: number }>>,
 *   models: string[],
 *   totalTokens: number,
 *   totalCalls: number,
 *   scannedAt: number,
 *   sessions: number,
 * }}
 */
function* collect() {
  const files = collectSessionFiles(sessionsRoot())
  const live = new Set()
  const global = new Map()
  const modelSet = new Set()
  let totalTokens = 0
  let totalCalls = 0
  let sinceYield = 0

  for (const file of files) {
    let info
    try {
      info = statSync(file)
    } catch {
      continue
    }
    live.add(file)
    let state = fileStates.get(file)

    // 文件没变：直接复用上次的聚合结果，连读都不用读
    if (state === undefined || state.size !== info.size || state.mtimeMs !== info.mtimeMs) {
      let raw
      try {
        raw = readFileSync(file)
      } catch {
        continue
      }
      const head = fingerprint(raw, 0, HEAD_BYTES)
      const tailOk = state !== undefined && state.consumed <= raw.length && state.tail === fingerprint(raw, state.consumed - TAIL_BYTES, TAIL_BYTES)
      if (state === undefined || state.consumed > raw.length || state.head !== head || !tailOk) {
        // 首次见到这个文件，或者文件被截断/改写过 → 从头再来
        state = newState()
        state.head = head
        const decoded = decodeFrames(raw, 0)
        parseInto(state, decoded.text, true)
        state.consumed = decoded.consumed
      } else {
        // 追加写：只解新增的帧
        const decoded = decodeFrames(raw, state.consumed)
        parseInto(state, decoded.text, true)
        state.consumed = decoded.consumed
      }
      state.size = info.size
      state.mtimeMs = info.mtimeMs
      state.tail = fingerprint(raw, state.consumed - TAIL_BYTES, TAIL_BYTES)
      fileStates.set(file, state)
    }

    for (const [mapKey, bucket] of state.map) {
      const current = global.get(mapKey)
      if (current === undefined) {
        global.set(mapKey, { ...bucket })
      } else {
        current.total += bucket.total
        current.input += bucket.input
        current.output += bucket.output
        current.calls += bucket.calls
      }
      const sep = mapKey.indexOf('\u0000')
      const day = mapKey.slice(0, sep)
      const key = mapKey.slice(sep + 1)
      modelSet.add(key)
    }
    sinceYield += 1
    if (sinceYield >= 8) {
      sinceYield = 0
      yield
    }
  }

  // 会话文件被清理掉的，把它的状态也丢掉
  for (const key of fileStates.keys()) {
    if (!live.has(key)) fileStates.delete(key)
  }

  const days = {}
  totalTokens = 0
  totalCalls = 0
  for (const [mapKey, bucket] of global) {
    const sep = mapKey.indexOf('\u0000')
    const day = mapKey.slice(0, sep)
    const key = mapKey.slice(sep + 1)
    if (days[day] === undefined) days[day] = {}
    days[day][key] = bucket
    totalTokens += bucket.total
    totalCalls += bucket.calls
  }

  return {
    days,
    models: [...modelSet].sort(),
    totalTokens,
    totalCalls,
    scannedAt: Date.now(),
    sessions: files.length,
  }
}

/** 同步扫一遍（测试、命令行用）。 */
export function scanUsage() {
  const iterator = collect()
  let result = iterator.next()
  while (!result.done) result = iterator.next()
  return result.value
}

/**
 * 异步扫一遍：每处理几个文件就把事件循环让出去，扫描期间不卡宿主进程。
 *
 * @returns {Promise<ReturnType<typeof scanUsage>>}
 */
export async function scanUsageAsync() {
  const iterator = collect()
  let result = iterator.next()
  while (!result.done) result = await iterator.next()
  return result.value
}

/** 清空增量缓存（测试用）。 */
export function resetCache() {
  fileStates.clear()
}
