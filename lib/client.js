/**
 * dsh-token-usage —— 浏览器侧。
 *
 * 挂一个「设置 → Token 用量」页面：顶部大数字 KPI、整年日历热力图、按模型
 * 分系列的每日趋势折线、模型排行。图例点击即隐藏系列，热力图与折线图悬停
 * （触屏点按）出明细。
 *
 * 手写成 `window.__ModuleLoader__` 工厂而不是打包产物：这个插件不发布到
 * 市场，不需要构建步骤，改完刷新即可。
 *
 * @module dsh-token-usage/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-token-usage',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    /** 侧边栏面板 id：图标按钮与中央面板用同一个 key。 */
    const PANEL_ID = 'token-usage'
    /** 用量数据路由（与宿主侧同源）。 */
    const USAGE_ENDPOINT = '/dsh-token-usage/usage'
    /** 自动刷新间隔。 */
    const REFRESH_MS = 60_000
    /**
     * 分类色板：第一个是品牌蓝，之后按黄金角（137.508°）在色相环上均匀铺开。
     *
     * 用黄金角而不是手调色表，是因为模型数量不固定——手调 12 色在 14 个模型
     * 时必然出现两个近似色（蓝/靛、紫/紫），黄金角序列里任意两色的色相差都
     * 不会小到难以分辨，颜色数量也可以随模型数一直扩。
     */
    /**
     * 当前主题是否深色。
     *
     * 三处信号都要看：宿主用 `data-theme`，harness 用 `body.dark`，
     * 而浏览器/系统偏好是 `prefers-color-scheme`。只看一处必然在某个环境下判错。
     */
    function isDarkTheme() {
      try {
        if (document.documentElement.dataset.theme === 'dark') return true
        if (document.body.classList.contains('dark')) return true
        return (
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches
        )
      } catch (error) {
        return false
      }
    }

    /** sRGB 通道 → 相对亮度（WCAG 2.x 定义）。 */
    function channelLum(value) {
      const c = value / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    }

    /** RGB 数组 → 相对亮度。 */
    function luminanceOf(rgb) {
      return 0.2126 * channelLum(rgb[0]) + 0.7152 * channelLum(rgb[1]) + 0.0722 * channelLum(rgb[2])
    }

    /** 两色的对比度（1..21）。 */
    function contrastBetween(a, b) {
      const la = luminanceOf(a)
      const lb = luminanceOf(b)
      const hi = Math.max(la, lb)
      const lo = Math.min(la, lb)
      return (hi + 0.05) / (lo + 0.05)
    }

    /** HSL → RGB 0..255。 */
    function hslToRgb(h, s, l) {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1
        if (t > 1) t -= 1
        if (t < 1 / 6) return p + (q - p) * 6 * t
        if (t < 1 / 2) return q
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
        return p
      }
      if (s === 0) return [Math.round(l * 255), Math.round(l * 255), Math.round(l * 255)]
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s
      const p = 2 * l - q
      return [
        Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
        Math.round(hue2rgb(p, q, h) * 255),
        Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
      ]
    }

    /** 主题背景色（用于算对比度）。 */
    function themeBackground() {
      return isDarkTheme() ? [18, 19, 22] : [255, 255, 255]
    }

    /**
     * 把色相夹到「在当前背景上 ≥ minRatio」的明度，色相与饱和度不动。
     *
     * 为什么不直接手调色表：模型数量不固定，色相距离是黄金角给的，
     * 动色相会让两个系列撞色；只有明度可以自由走，既保住可分辨性，
     * 又保证浅色主题下不会出现 1.7:1 那种「画了但看不见」的系列色。
     *
     * @param hue 0..360
     * @param saturation 0..1
     * @param minRatio 目标对比度，正文/图形默认 4.5
     */
    function readableColor(hue, saturation, minRatio) {
      const bg = themeBackground()
      const target = typeof minRatio === 'number' ? minRatio : 4.5
      const candidates = []
      for (let step = 0; step <= 32; step += 2) {
        candidates.push(0.5 - step / 100)
        candidates.push(0.5 + step / 100)
      }
      for (const lightness of candidates) {
        if (lightness < 0.22 || lightness > 0.8) continue
        const rgb = hslToRgb((hue % 360) / 360, saturation, lightness)
        if (contrastBetween(rgb, bg) >= target) {
          return 'hsl(' + (hue % 360).toFixed(1) + ' ' + Math.round(saturation * 100) + '% ' + Math.round(lightness * 100) + '%)'
        }
      }
      return isDarkTheme() ? '#cbd5e1' : '#334155'
    }

    /** 品牌色按主题夹到可读值：浅色用更深的蓝，深色用更亮的蓝。 */
    function accentColor() {
      return isDarkTheme() ? readableColor(217, 0.9, 4.5) : readableColor(217, 0.83, 4.5)
    }

    /**
     * 分类色板：第一个是品牌蓝，之后按黄金角（137.508°）在色相环上均匀铺开。
     *
     * 用黄金角而不是手调色表，是因为模型数量不固定——手调 12 色在 14 个模型
     * 时必然出现两个近似色（蓝/靛、紫/紫），黄金角序列里任意两色的色相差都
     * 不会小到难以分辨，颜色数量也可以随模型数一直扩。
     *
     * 明度不再是常量 50%：按主题夹到 ≥4.5:1（见 readableColor）。实测原实现
     * 在白底有 19/31 个色低于 4.5:1，最差 1.70:1 —— 系列画了等于没画。
     */
    let PALETTE = []

    /** 重建调色板：主题变了要重新夹明度，所以它是个函数而不是常量。 */
    function refreshPalette() {
      const brand = accentColor()
      PALETTE = [
        brand,
        ...Array.from({ length: 31 }, (_, index) => {
          const hue = (217 + (index + 1) * 137.508) % 360
          return readableColor(hue, 0.64, 4.5)
        }),
      ]
    }

    /** 颜色表里没命中时的兜底色：灰阶也必须过对比度，否则「其他」整类不可见。 */
    function othersColor() {
      return isDarkTheme() ? '#9aa3af' : '#5b6472'
    }

    /* ───────────────────────── 工具 ───────────────────────── */

    const fmtN = (n) => Number(n).toLocaleString('zh-CN')
    const fmtCN = (n) => (n >= 1e8
      ? `${(n / 1e8).toFixed(2).replace(/\.?0+$/, '')}亿`
      : n >= 1e4
        ? `${(n / 1e4).toFixed(1).replace(/\.0$/, '')}万`
        : fmtN(n))
    const fmtCN2 = (n) => (n >= 1e8 ? `${(n / 1e8).toFixed(2)}亿` : n >= 1e4 ? `${(n / 1e4).toFixed(1)}万` : fmtN(n))
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
    const pad2 = (n) => String(n).padStart(2, '0')
    const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    /** 中文日期：2026年10月15日 */
    const fmtDateCN = (iso) => {
      const [year, month, day] = iso.split('-')
      return `${year}年${Number(month)}月${Number(day)}日`
    }
    /** 带空格的量级写法：5.8 亿 / 3317 万 / 8,739 */
    const fmtTokensCN = (value) => {
      const num = Number(value) || 0
      if (num >= 1e8) {
        const scaled = num / 1e8
        return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1).replace(/\.0$/, '')} 亿`
      }
      if (num >= 1e4) {
        const scaled = num / 1e4
        return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1).replace(/\.0$/, '')} 万`
      }
      return fmtN(num)
    }

    /* ───────────────────────── 动效 ───────────────────────── */

    /**
     * Electron 宿主在检测到辅助技术时会于渲染器内强制 prefers-reduced-motion:
     * reduce（系统设置本身是关的），导致所有动画被跳过、数字瞬间定格。
     * 本插件为本地自用、动画参数经调参台确认，故默认忽略该强制位。
     * 想恢复无障碍遵循时把 IGNORE_REDUCED_MOTION 改回 false。
     */
    const IGNORE_REDUCED_MOTION = true

    const reducedMotion = () =>
      !IGNORE_REDUCED_MOTION &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    /**
     * 进行中的动画取消句柄。render() 重画和 destroy() 时统一掐掉，
     * 避免旧 rAF 闭包继续写已经脱离文档的节点。
     */
    const anims = new Set()

    /** 取消所有进行中的动画。 */
    function cancelAllAnims() {
      for (const cancel of [...anims]) cancel()
    }

    /**
     * 数字滚动：rAF + ease-out cubic，从 from 数到 to。
     * format 在每一帧生效，所以千分位/“x 天”这类后缀都能跟着滚。
     */
    function countUp(node, from, to, { duration = 1400, delay = 0, format = fmtN } = {}) {
      // ease-in-out cubic：慢起→中段加速→缓停。原 ease-out 前半秒就冲掉近半
      // 数值，无论总时长多长，观感都是"起步即冲刺"的快；in-out 从静止渐进。
      const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
      if (reducedMotion() || from === to) {
        node.textContent = format(to)
        return
      }
      const cancel = () => {
        window.cancelAnimationFrame(raf)
        anims.delete(cancel)
      }
      const startAt = performance.now() + delay
      let raf = 0
      const frame = (now) => {
        const p = Math.min(1, Math.max(0, (now - startAt) / duration))
        node.textContent = format(Math.round(from + (to - from) * ease(p)))
        if (p < 1) raf = requestAnimationFrame(frame)
        else {
          node.textContent = format(to)
          anims.delete(cancel)
        }
      }
      anims.add(cancel)
      raf = requestAnimationFrame(frame)
    }

    const clamp01 = (x) => Math.min(1, Math.max(0, x))

    /**
     * 弹簧排行条：fill 宽度从 from 比例弹到 to，允许冲过头再回弹（欠阻尼）。
     * 读数 valEl 与同一个弹簧位置 x lockstep——条回弹时数字也跟着退一点再
     * 定格，因果一致才“像量出来的”。读数侧 clamp 到 [0,1]，超调只发生在条上。
     *
     * 注意 x 是“相对第一名的宽度比例”，不等于本行自己的完成度：第二行目标
     * 0.89，x 走到 0.89 就是 100% 完成。所以读数必须用 x / to 折算，
     * 否则每行定格时只会显示 目标值 × 自身占比（3.19 亿而不是 3.59 亿）。
     */
    function springBar(fill, valEl, from, to, { total = 0, calls = 0, stiffness = 80, damping = 9, delay = 0 } = {}) {
      const apply = (x) => {
        fill.style.width = `${(x * 100).toFixed(2)}%`
        if (valEl !== null) {
          const done = to > 0 ? clamp01(x / to) : 0
          valEl.textContent = calls > 0
            ? `${fmtCN2(Math.round(total * done))} · ${fmtN(Math.round(calls * done))} 次`
            : fmtCN2(Math.round(total * done))
        }
      }
      if (reducedMotion() || Math.abs(from - to) < 1e-4) {
        apply(to)
        return
      }
      const cancel = () => {
        window.cancelAnimationFrame(raf)
        anims.delete(cancel)
      }
      let x = from
      let v = 0
      let last = performance.now()
      const startAt = last + delay
      let raf = 0
      const frame = (now) => {
        if (now < startAt) {
          raf = requestAnimationFrame(frame)
          return
        }
        const dt = Math.min(0.032, Math.max(0.001, (now - last) / 1000))
        last = now
        // 半隐式欧拉：先更新速度再更新位置，能量稳定
        v += (stiffness * (to - x) - damping * v) * dt
        x += v * dt
        const settled = Math.abs(to - x) < 0.0004 && Math.abs(v) < 0.0015
        apply(settled ? to : x)
        if (settled) anims.delete(cancel)
        else raf = requestAnimationFrame(frame)
      }
      anims.add(cancel)
      raf = requestAnimationFrame(frame)
    }

    /** 把 provider/model 拆成可读短名与 provider。 */
    const nameCache = new Map()
    function splitName(key) {
      if (nameCache.has(key)) return nameCache.get(key)
      const parts = key.split('/')
      const model = parts[parts.length - 1]
      const provider = parts[0]
      const short = model.replace(/^(deepseek|z-ai|xiaomi|qwen|google|xai|tencent)\//, '')
      const value = { short, provider }
      nameCache.set(key, value)
      return value
    }

    /* ───────────────────────── 样式 ───────────────────────── */

    const STYLE = `
.dsh-tu-page{height:100%;min-height:0;overflow:auto;padding:18px 22px 28px;box-sizing:border-box}
.dsh-tu{--tu-panel:var(--dsw-alias-bg-layer-1,#f4f4f5);--tu-panel-2:var(--dsw-alias-bg-layer-2,#ebecf0);
  --tu-line:var(--dsw-alias-border-l1,#e0e2e6);--tu-t1:var(--dsw-alias-label-primary,#18181b);
  --tu-t2:var(--dsw-alias-label-secondary,#52525b);--tu-t3:var(--dsw-alias-label-tertiary,#8a8f98);
  --tu-accent:var(--dsw-static-deepseek-450,#3b82f6);--tu-hover:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));
  --tu-empty:var(--dsw-alias-bg-layer-2,#e9e9eb);
  color:var(--tu-t1);font:14px/1.6 var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif);
  display:flex;flex-direction:column;gap:16px;width:100%;max-width:1200px;box-sizing:border-box}
.dsh-tu *,.dsh-tu *::before,.dsh-tu *::after{box-sizing:border-box}
.dsh-tu-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dsh-tu-title{font-size:15px;font-weight:600;margin:0;font-family:inherit}
.dsh-tu-note{font-size:12px;color:var(--tu-t2);margin:2px 0 0;max-width:70ch}
.dsh-tu-btn{border:0;background:var(--dsw-alias-button-elevated-fill,rgba(0,0,0,.04));color:var(--tu-t2);
  font:inherit;font-size:12.5px;padding:4px 12px;border-radius:999px;cursor:pointer;transition:background .13s,color .13s;
  min-height:32px;display:inline-flex;align-items:center}
/* 触摸设备给足 44px：桌面 28–32px 的胶囊在指腹下太薄 */
@media (hover:none){.dsh-tu-btn,.dsh-tu-seg button{min-height:44px}}
.dsh-tu-btn:hover{background:var(--tu-hover);color:var(--tu-t1)}
/* 主按钮：底色按主题夹过对比度，文字色随之反转（白字压 3.68:1 的蓝不达标） */
.dsh-tu-btn.is-on{background:var(--tu-accent,#2563eb);color:var(--tu-on-accent,#fff)}
.dsh-tu-kpis{display:grid;grid-template-columns:repeat(5,1fr);background:color-mix(in srgb,currentColor 4%,transparent);border:1px solid color-mix(in srgb,currentColor 9%,transparent);border-radius:var(--dsw-radius-lg,18px);padding:22px 8px}
.dsh-tu-kpi{text-align:center;padding:0 8px}
.dsh-tu-kpi+.dsh-tu-kpi{border-left:1px solid color-mix(in srgb,currentColor 10%,transparent)}
.dsh-tu-kpi .v{font-size:26px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.2}
.dsh-tu-kpi .k{font-size:13px;color:var(--tu-t2);margin-top:3px}
.dsh-tu-kpi .s{font-size:12px;color:var(--tu-t2)}
.dsh-tu-card{position:relative;background:color-mix(in srgb,currentColor 4%,transparent);border:1px solid color-mix(in srgb,currentColor 9%,transparent);border-radius:var(--dsw-radius-lg,18px);padding:20px 22px}
.dsh-tu-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.dsh-tu-card-head h3{font-size:14px;font-weight:600;margin:0}
.dsh-tu-hint{font-size:12px;color:var(--tu-t2)}
.dsh-tu-seg{display:inline-flex;gap:2px;background:color-mix(in srgb,currentColor 7%,transparent);border-radius:10px;padding:3px}
.dsh-tu-seg button{border:0;background:transparent;color:var(--tu-t2);font:inherit;font-size:12.5px;
  padding:4px 13px;border-radius:8px;cursor:pointer;min-height:32px}
.dsh-tu-seg button.is-on{background:color-mix(in srgb,currentColor 13%,transparent);color:var(--tu-t1);font-weight:600}
.dsh-tu-chip{display:inline-flex;align-items:center;gap:7px;border:0;border-radius:999px;background:color-mix(in srgb,currentColor 7%,transparent);
  color:var(--tu-t2);font:inherit;font-size:12.5px;padding:5px 12px;cursor:pointer;min-height:32px}
.dsh-tu-chip.is-on{background:color-mix(in srgb,currentColor 13%,transparent);color:var(--tu-t1);box-shadow:0 1px 2px rgba(0,0,0,.06)}
.dsh-tu-chip i{width:8px;height:8px;border-radius:50%;flex:none}
.dsh-tu-chip .n{color:var(--tu-t2);font-size:12px;font-variant-numeric:tabular-nums}
.dsh-tu-svg{display:block;overflow:visible}
.dsh-tu-heat-scroll{overflow-x:auto;overflow-y:hidden}
.dsh-tu-svg text{font-size:12px;fill:var(--tu-t2)}
.dsh-tu-svg .tick{font-size:12px;fill:var(--tu-t2);font-variant-numeric:tabular-nums}
.dsh-tu-svg .grid{stroke:var(--tu-t3);stroke-width:1;stroke-dasharray:2 5;opacity:.3}
.dsh-tu-svg .cross{stroke:var(--tu-t3);stroke-width:1;stroke-dasharray:3 3}
.dsh-tu-svg rect.cell{cursor:pointer}
.dsh-tu-svg rect.cell:hover{stroke:var(--tu-t1);stroke-width:1.5}
.dsh-tu-heat-note{font-size:12.5px;color:var(--tu-t2);margin:10px 0 0;display:flex;align-items:center;gap:6px}
.dsh-tu-heat-note b{color:var(--tu-t1);font-weight:600}
.dsh-tu-heat-note i{display:inline-block;width:2px;height:13px;background:var(--tu-accent);border-radius:1px}
.dsh-tu-table-wrap{max-height:320px;overflow:auto;border:1px solid color-mix(in srgb,currentColor 9%,transparent);border-radius:12px}
.dsh-tu-table{width:100%;border-collapse:collapse;font-size:12.5px}
.dsh-tu-table caption{text-align:left;font-size:12px;color:var(--tu-t2);padding:8px 10px}
.dsh-tu-table th{position:sticky;top:0;background:color-mix(in srgb,currentColor 7%,transparent);text-align:right;
  font-weight:600;color:var(--tu-t2);padding:7px 10px;font-size:12px}
.dsh-tu-table th:first-child,.dsh-tu-table td:first-child{text-align:left}
.dsh-tu-table td{padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;border-top:1px solid color-mix(in srgb,currentColor 7%,transparent)}
.dsh-tu-table tr:hover td{background:color-mix(in srgb,currentColor 4%,transparent)}
.dsh-tu-heat-legend{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--tu-t2);justify-content:flex-end;margin-top:8px}
.dsh-tu-heat-legend span.b{width:12px;height:12px;border-radius:4px}
.dsh-tu-tip{position:absolute;pointer-events:none;background:var(--dsw-alias-bg-base,#fff);
  border:1px solid var(--dsw-alias-border-l2,#d0d3d8);border-radius:12px;box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,.14));
  padding:10px 13px;font-size:12.5px;min-width:200px;max-width:340px;z-index:20;display:none}
.dsh-tu-tip .t{font-weight:600;margin-bottom:5px;font-variant-numeric:tabular-nums}
.dsh-tu-tip .row{display:flex;justify-content:space-between;gap:14px;font-variant-numeric:tabular-nums;line-height:1.75}
/* 名称列可压缩并省略，数值列不换行 */
.dsh-tu-tip .row .m{color:var(--tu-t2);display:flex;align-items:center;gap:6px;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 auto}
.dsh-tu-tip .row .m i{width:8px;height:8px;border-radius:50%;flex:none}
.dsh-tu-tip .row .v{font-weight:500;white-space:nowrap;flex:none}
.dsh-tu-tip .total{border-top:1px solid var(--dsw-alias-border-l1,#e0e2e6);margin-top:5px;padding-top:5px;font-weight:600}
.dsh-tu-rank .rrow{display:grid;grid-template-columns:20px minmax(150px,240px) 1fr auto;gap:14px;align-items:center;padding:5px 0;font-size:13px}
.dsh-tu-rank .idx{font-size:11.5px;color:var(--tu-t3);text-align:right;font-variant-numeric:tabular-nums}
.dsh-tu-rank .name{display:flex;align-items:center;gap:8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;min-width:0}
.dsh-tu-rank .name .pv{min-width:0;overflow:hidden;text-overflow:ellipsis}
.dsh-tu-rank .name i{width:9px;height:9px;border-radius:50%;flex:none}
.dsh-tu-rank .name .pv{color:var(--tu-t2);font-size:12px}
.dsh-tu-rank .bar{height:9px;border-radius:5px;background:color-mix(in srgb,currentColor 9%,transparent);overflow:hidden}
.dsh-tu-rank .bar i{display:block;height:100%;border-radius:5px}
.dsh-tu-rank .val{font-variant-numeric:tabular-nums;color:var(--tu-t2);min-width:96px;text-align:right}
.dsh-tu-empty{padding:40px 0;text-align:center;color:var(--tu-t2);font-size:13px}
.dsh-tu-empty .sub{display:block;margin-top:6px;font-size:12.5px;color:var(--tu-t3)}
.dsh-tu-empty .act{margin-top:14px;display:flex;gap:8px;justify-content:center}
/* 首帧骨架：尺寸与真实内容一致，避免数据到达时整页跳动（CLS） */
.dsh-tu-skel{background:color-mix(in srgb,currentColor 8%,transparent);border-radius:8px;
  position:relative;overflow:hidden}
.dsh-tu-skel::after{content:"";position:absolute;inset:0;transform:translateX(-100%);
  background:linear-gradient(90deg,transparent,color-mix(in srgb,currentColor 10%,transparent),transparent);
  animation:dsh-tu-shimmer 1.4s ease-in-out infinite}
@keyframes dsh-tu-shimmer{to{transform:translateX(100%)}}
@media (prefers-reduced-motion:reduce){.dsh-tu-skel::after{animation:none}}
.dsh-tu-kpi .v.is-skel{height:31px;width:70%;margin:0 auto}
.dsh-tu-kpi .k.is-skel{height:13px;width:52%;margin:9px auto 0}
.dsh-tu-kpi .s.is-skel{height:12px;width:64%;margin:7px auto 0}
.dsh-tu-blk{height:120px;margin-top:4px}
.dsh-tu-blk.tall{height:300px}
@media (max-width:760px){
  .dsh-tu-kpis{grid-template-columns:repeat(2,1fr);padding:12px 4px;gap:4px 0}
  .dsh-tu-kpi{padding:8px 4px}
  .dsh-tu-kpi:nth-child(2n+1){border-left:0}
  .dsh-tu-kpi:nth-child(2n){border-left:1px solid var(--tu-panel-2)}
  .dsh-tu-kpi:last-child{grid-column:1/-1;border-left:0;border-top:1px solid var(--tu-panel-2);padding-top:10px;margin-top:4px}
  .dsh-tu-kpi .v{font-size:20px}
  .dsh-tu-card{padding:16px 14px}
  .dsh-tu-rank .rrow{grid-template-columns:16px minmax(100px,140px) 1fr auto;gap:8px}
}
`

    let styleInjected = false
    function ensureStyle() {
      if (styleInjected) return
      if (typeof document === 'undefined') return
      const style = document.createElement('style')
      style.id = 'dsh-token-usage-styles'
      style.textContent = STYLE
      document.head.append(style)
      styleInjected = true
    }

    /* ───────────────────── 绘图工具 ───────────────────── */

    /**
     * 单调三次插值（Fritsch–Carlson）。
     *
     * 用 Catmull-Rom 这类自由样条时，落差大的相邻点会让曲线**过冲**：数据从
     * 1.2 亿掉到 0 再抬起来，控制点会把曲线压到 0 以下，视觉上就是曲线穿过
     * 横轴跑到图外。单调插值在每段内都保证取值落在两端点之间，因此不会跌到
     * 负值，同时仍是平滑曲线。
     */
    /**
     * Catmull-Rom → 三次贝塞尔：切线取前后邻居向量，任意两段之间 C1 连续，
     * 没有人为拐点。控制点越界时不做硬夹持（那会扭断切线方向、在尖峰处产生
     * 新拐点），而是按比例缩短切线向量——方向不变、只收敛幅度，过冲被压在
     * 绘图区内且无方向突变。
     */
    function spline(points, clampY) {
      const n = points.length
      if (n < 2) return ''
      if (n === 2) return `M${points[0].x},${points[0].y}L${points[1].x},${points[1].y}`
      const t = 0.2
      const bottom = clampY ? clampY.bottom : Infinity
      /**
       * 零值日特殊形态：某天耗量为 0 时曲线扎到基线再反弹，Catmull-Rom 的
       * 切线 ∝ 前后邻居之差，会让零值邻居的峰顶切线歪向基线（"歪旗"拐点）、
       * 零值谷底本身也可能不对称。对这些锚点强制水平切线：贴基线的点、
       * 以及紧邻贴基线点的局部极值——峰顶/谷底变成对称圆拱，其余位置不受影响。
       */
      const atBottom = points.map((p) => p.y >= bottom - 0.5)
      const horizontal = points.map((p, i) => {
        if (atBottom[i]) return true
        const prevOk = i > 0
        const nextOk = i < n - 1
        const neighborZero = (prevOk && atBottom[i - 1]) || (nextOk && atBottom[i + 1])
        if (!neighborZero) return false
        const upLeft = !prevOk || p.y <= points[i - 1].y
        const downLeft = !prevOk || p.y >= points[i - 1].y
        const upRight = !nextOk || p.y <= points[i + 1].y
        const downRight = !nextOk || p.y >= points[i + 1].y
        return (upLeft && upRight) || (downLeft && downRight)
      })
      /** 切线向量越界时等比缩放（方向保持），返回收敛后的控制点。 */
      const tamed = (anchor, off) => {
        if (!clampY || off.y === 0) return { x: anchor.x + off.x, y: anchor.y + off.y }
        const y = anchor.y + off.y
        let s = 1
        if (y < clampY.top) s = (clampY.top - anchor.y) / off.y
        else if (y > clampY.bottom) s = (clampY.bottom - anchor.y) / off.y
        if (s < 0) s = 0
        return { x: anchor.x + off.x * s, y: anchor.y + off.y * s }
      }

      let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`
      for (let i = 0; i < n - 1; i += 1) {
        const p1 = points[i]
        const p2 = points[i + 1]
        // 端点用镜像虚拟邻居（2·端点 − 内点），端点切线等于割线方向，
        // 曲线以自然直线趋势入场/收尾，不会在首尾两天出现弯折。
        const p0 = i === 0 ? { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y } : points[i - 1]
        const p3 = i === n - 2 ? { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y } : points[i + 2]
        const c1 = tamed(p1, { x: (p2.x - p0.x) * t, y: horizontal[i] ? 0 : (p2.y - p0.y) * t })
        const c2 = tamed(p2, { x: (p1.x - p3.x) * t, y: horizontal[i + 1] ? 0 : (p1.y - p3.y) * t })
        d += `C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
      }
      return d
    }

    /** 取整齐的刻度值（1 / 2 / 5 × 10^n）。 */
    function niceTicks(max, count) {
      const raw = max / count
      const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
      const normalized = raw / magnitude
      const step = (normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10) * magnitude
      const out = []
      for (let value = step; value <= max * 1.02; value += step) out.push(value)
      return out.length > 0 ? out : [max]
    }

    /* ───────────────────── 数据视图 ───────────────────── */

    /**
     * 连续日历轴：范围内的每一天都占位（无记录 → 0），折线才不会在空档处断掉，
     * 空档的宽度也是真实的天数。
     */
    function continuousDays(days, range) {
      if (days.length === 0) return []
      const last = days[days.length - 1]
      let first = days[0]
      if (range !== 'all') {
        const span = Number(range)
        const end = new Date(`${last}T12:00:00`)
        const begin = new Date(end)
        begin.setDate(begin.getDate() - (span - 1))
        first = fmtDate(begin)
      }
      const out = []
      const cursor = new Date(`${first}T12:00:00`)
      const end = new Date(`${last}T12:00:00`)
      while (cursor <= end) {
        out.push(fmtDate(cursor))
        cursor.setDate(cursor.getDate() + 1)
      }
      return out
    }

    /** 按范围内总量排序的模型列表。 */
    function rankedModels(payload, days) {
      const totals = new Map()
      for (const day of days) {
        const bucket = payload.days[day]
        if (bucket === undefined) continue
        for (const key of Object.keys(bucket)) {
          const current = totals.get(key) || { total: 0, calls: 0 }
          current.total += bucket[key].total
          current.calls += bucket[key].calls
          totals.set(key, current)
        }
      }
      return [...totals.entries()].sort((a, b) => b[1].total - a[1].total)
    }

    /** 模型 → 颜色。按全量数据的排名分配，切换时间范围时颜色不会跳。 */
    const COLORS = new Map()

    /** 用全量数据重排颜色表。 */
    function refreshColors(payload) {
      const totals = new Map()
      for (const day of Object.keys(payload.days ?? {})) {
        const bucket = payload.days[day]
        for (const key of Object.keys(bucket)) totals.set(key, (totals.get(key) ?? 0) + bucket[key].total)
      }
      const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1])
      COLORS.clear()
      ordered.forEach(([key], index) => {
        COLORS.set(key, PALETTE[index % PALETTE.length])
      })
    }

    /**
     * 短名出现次数（全局统计）。
     *
     * 同名不同 provider 是常态：`command/deepseek/deepseek-v4.1-flash` 和
     * `opencode-go/deepseek-v4.1-flash` 短名完全一样，提示框里两行会长得
     * 一模一样。所以短名重复时补上 provider 消歧。
     */
    let shortCounts = new Map()

    /** 统计全局每个短名出现过几次。 */
    function refreshShortNames(payload) {
      shortCounts = new Map()
      for (const day of Object.keys(payload.days ?? {})) {
        for (const key of Object.keys(payload.days[day])) {
          const info = splitName(key)
          shortCounts.set(info.short, (shortCounts.get(info.short) ?? 0) + 1)
        }
      }
    }

    /** 显示用名称：同名时带上 provider 消歧。 */
    function displayName(key) {
      const info = splitName(key)
      return (shortCounts.get(info.short) ?? 0) > 1 ? `${info.short} · ${info.provider}` : info.short
    }


    /* ───────────────────── 渲染 ───────────────────── */

    /**
     * 把面板挂到宿主给的容器里。
     *
     * @param {HTMLElement} root - 宿主的挂载点。
     * @returns {{ destroy: () => void }}
     */
    function mountDashboard(root) {
      ensureStyle()
      root.classList.add('dsh-tu')
      // 主题相关色值集中在这里写：CSS 里拿不到 prefers-color-scheme 之外的信号，
      // 而宿主可能是用 data-theme 切的主题。
      refreshPalette()
      root.style.setProperty('--tu-accent', accentColor())
      root.style.setProperty('--tu-on-accent', isDarkTheme() ? '#0b0b0e' : '#ffffff')

      const state = {
        payload: null,
        range: 'all',
        hmMode: 'day',
        hmView: 'heat',
        pinned: null,
        error: null,
        // 动效记账：KPI 上次显示值 / 是否已入场 / 排行条上次比例与数据签名
        kpiShown: null,
        kpiVisible: false,
        rankVisible: false,
        rankSig: null,
        rankShown: new Map(),
      }

      root.innerHTML = `
        <div class="dsh-tu-head">
          <div>
            <h2 class="dsh-tu-title">Token 用量</h2>
            <p class="dsh-tu-note" data-el="note">正在读取…</p>
          </div>
          <div class="dsh-tu-seg" data-el="range">
            <button data-r="7">近 7 日</button>
            <button data-r="30">近 30 日</button>
            <button data-r="90">近 90 日</button>
            <button data-r="all" class="is-on">全部</button>
          </div>
        </div>
        <div class="dsh-tu-kpis" data-el="kpis" aria-live="polite" aria-atomic="false"></div>
        <div class="dsh-tu-card">
          <div class="dsh-tu-card-head">
            <h3>Token 活动</h3>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <div class="dsh-tu-seg" data-el="hmMode">
                <button data-m="day" class="is-on">每日</button>
                <button data-m="week">每周</button>
                <button data-m="cum">累计</button>
              </div>
              <div class="dsh-tu-seg" data-el="hmView">
                <button data-v="heat" class="is-on">热力</button>
                <button data-v="table">表格</button>
              </div>
            </div>
          </div>
          <div data-el="heat"></div>
          <p class="dsh-tu-heat-note" data-el="heatNote"></p>
          <div class="dsh-tu-heat-legend" data-el="heatLegend"></div>
          <div class="dsh-tu-tip" data-el="heatTip"></div>
        </div>
        <div class="dsh-tu-card">
          <div class="dsh-tu-card-head">
            <h3>每日 Token 消耗趋势</h3>
            <span class="dsh-tu-hint" data-el="chartHint"></span>
          </div>
          <div data-el="line" style="position:relative"></div>
          <div class="dsh-tu-tip" data-el="lineTip"></div>
        </div>
        <div class="dsh-tu-card dsh-tu-rank">
          <div class="dsh-tu-card-head"><h3>模型排行</h3><span class="dsh-tu-hint">范围内全部模型</span></div>
          <div data-el="rank"></div>
        </div>
      `

      const el = (name) => root.querySelector(`[data-el="${name}"]`)
      // 首帧：先把骨架按真实尺寸铺好，再等数据（CLS 归零，读屏知道正在忙）
      root.setAttribute('aria-busy', 'true')
      renderSkeleton(el('kpis'), el('heat'), el('line'), el('rank'))

    /**
     * 空态块：一句话说明 + 可执行动作。
     *
     * 原来的空态只有一句话、没有出口（知识库 Empty States：Show helpful message
     * AND action）。这里的按钮走事件委托，所以重绘后不需要重新绑定。
     */
    function emptyBlock(title, hint) {
      const extra = hint === undefined || hint === null ? '' : '<span class="sub">' + esc(hint) + '</span>'
      return '<div class="dsh-tu-empty">' + esc(title) + extra +
        '<div class="act"><button type="button" class="dsh-tu-btn" data-act="refresh">重新读取</button></div></div>'
    }

    /** 首帧骨架：形状与真实内容一致，数据到达时不跳动。 */
    function renderSkeleton(kpis, heat, line, rank) {
      kpis.innerHTML = Array.from({ length: 5 }, () =>
        '<div class="dsh-tu-kpi"><div class="v is-skel dsh-tu-skel"></div>' +
        '<div class="k is-skel dsh-tu-skel"></div><div class="s is-skel dsh-tu-skel"></div></div>').join('')
      heat.innerHTML = '<div class="dsh-tu-skel dsh-tu-blk tall"></div>'
      line.innerHTML = '<div class="dsh-tu-skel dsh-tu-blk tall"></div>'
      rank.innerHTML = '<div class="dsh-tu-skel dsh-tu-blk"></div>'
    }

      /** 服务端返回旧快照时的补取定时器。 */
      let refetchTimer = null

      const rangeSeg = el('range')
      rangeSeg.addEventListener('click', (event) => {
        const button = event.target.closest('button')
        if (button === null) return
        state.range = button.dataset.r
        for (const item of rangeSeg.querySelectorAll('button')) item.classList.toggle('is-on', item === button)
        // 换口径相当于换数据集：排行条从 0 重弹，而不是从旧口径的比例续接
        state.rankShown = new Map()
        state.rankSig = null
        render()
      })
      const hmSeg = el('hmMode')
      hmSeg.addEventListener('click', (event) => {
        const button = event.target.closest('button')
        if (button === null) return
        state.hmMode = button.dataset.m
        for (const item of hmSeg.querySelectorAll('button')) item.classList.toggle('is-on', item === button)
        render()
      })

      const hmViewSeg = el('hmView')
      hmViewSeg.addEventListener('click', (event) => {
        const button = event.target.closest('button')
        if (button === null) return
        state.hmView = button.dataset.v
        for (const item of hmViewSeg.querySelectorAll('button')) item.classList.toggle('is-on', item === button)
        // 表格视图下 hmMode 三个分段没有意义，但保留可见以免布局跳动
        render()
      })

      // 入场闸门：KPI 数字与排行条都要等真正进入视口才播，否则等于在屏外演完。
      // 观察必须等到首帧数据画完再开始——面板刚挂载时还是空壳、页面很矮，
      // 排行卡会被误判成“已在视口内”，动画就又在屏外跑掉了。
      const kpisBox = el('kpis')
      const rankBox = el('rank')
      let kpiEntry = null
      let rankEntry = null
      let observing = false
      const revealIo = typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting || entry.intersectionRatio <= 0) continue
              const isKpi = entry.target === kpisBox
              const run = isKpi ? kpiEntry : rankEntry
              if (isKpi) {
                state.kpiVisible = true
                kpiEntry = null
              } else {
                state.rankVisible = true
                rankEntry = null
              }
              if (typeof run === 'function') run()
            }
          }, { threshold: 0.05 })
        : null
      /** 首帧数据画完后才 observe，此时卡片有真实高度。 */
      function startObserving() {
        if (revealIo === null || observing || state.payload === null) return
        observing = true
        revealIo.observe(kpisBox)
        revealIo.observe(rankBox)
      }

      /**
       * 拉一次数据。
       *
       * 服务端是 stale-while-revalidate：快照过期时它会**立刻**返回旧数据，
       * 同时在后台重扫，并用 x-token-usage-stale 头说明"这是旧的"。所以这里
       * 看到 stale 就稍后再取一次，把刚刷新的数据换上——用户全程不用等。
       */
      async function load() {
        try {
          const response = await fetch(USAGE_ENDPOINT, { cache: 'no-store' })
          if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
          const payload = await response.json()
          state.payload = payload
          state.error = null
          refreshColors(payload)
          refreshShortNames(payload)
          const days = Object.keys(payload.days ?? {}).sort()
          if (response.headers?.get('x-token-usage-stale') === '1') scheduleRefetch()
        } catch (error) {
          state.error = error instanceof Error ? error.message : String(error)
        }
        render()
      }

      /**
       * 稍后再取一次（服务端后台重扫已经发起）。
       *
       * 1.2 秒足够一次毫秒级增量扫描跑完；不排下一次，避免和服务端重扫赛跑。
       */
      function scheduleRefetch() {
        if (refetchTimer !== null) return
        refetchTimer = window.setTimeout(() => {
          refetchTimer = null
          void load()
        }, 1200)
      }

      function render() {
        cancelAllAnims()
        if (state.payload === null) {
          // 首次读取：继续显示骨架；失败则换成带重试的错误块（不再是一行小字）
          if (state.error !== null) {
            el('note').textContent = '读取失败'
            const fail = '<div class="dsh-tu-empty">读取失败：' + esc(state.error) +
              '<span class="sub">宿主侧路由 /dsh-token-usage/usage 没有响应</span>' +
              '<div class="act"><button type="button" class="dsh-tu-btn" data-act="refresh">重试</button></div></div>'
            // KPI 是 5 列网格：错误块必须独占整行，否则被挤在第一列
            el('kpis').style.gridTemplateColumns = '1fr'
            el('kpis').innerHTML = fail
            el('heat').innerHTML = ''
            el('line').innerHTML = ''
            el('rank').innerHTML = ''
            root.setAttribute('aria-busy', 'false')
          }
          return
        }
        root.setAttribute('aria-busy', 'false')
        el('kpis').style.gridTemplateColumns = ''
        const payload = state.payload
        const allDays = Object.keys(payload.days ?? {}).sort()
        const days = allDays.filter((day) => {
          if (state.range === 'all') return true
          const span = Number(state.range)
          const end = new Date(`${allDays[allDays.length - 1]}T12:00:00`)
          const begin = new Date(end)
          begin.setDate(begin.getDate() - (span - 1))
          const moment = new Date(`${day}T12:00:00`)
          return moment >= begin && moment <= end
        })

        el('note').innerHTML = `统计自本机 DSH 会话记录 · 共 <b>${allDays.length}</b> 天有记录 · <b>${fmtCN(payload.totalTokens)}</b> tokens · <b>${fmtN(payload.totalCalls)}</b> 次调用`

        renderKpis(payload, allDays)
        const ranked = rankedModels(payload, days)
        renderHeat(payload, allDays)
        renderLine(payload, days)
        renderRank(payload, days, ranked)
        // 画完这一帧再开始观察，卡片此刻才有真实高度
        if (!observing) requestAnimationFrame(startObserving)
      }

      function renderKpis(payload, allDays) {
        let total = 0
        let peak = { value: 0, day: null }
        for (const day of allDays) {
          const bucket = payload.days[day]
          let sum = 0
          for (const key of Object.keys(bucket)) sum += bucket[key].total
          total += sum
          if (sum > peak.value) peak = { value: sum, day }
        }
        const daysWithUse = allDays.filter((day) => {
          const bucket = payload.days[day]
          return Object.keys(bucket).some((key) => bucket[key].total > 0)
        })
        const streak = (() => {
          let current = 0
          for (let index = allDays.length - 1; index >= 0; index -= 1) {
            const bucket = payload.days[allDays[index]]
            const used = Object.keys(bucket).some((key) => bucket[key].total > 0)
            if (used) current += 1
            else if (current > 0) break
          }
          let best = 0
          let run = 0
          for (const day of allDays) {
            const bucket = payload.days[day]
            const used = Object.keys(bucket).some((key) => bucket[key].total > 0)
            if (used) { run += 1; best = Math.max(best, run) } else run = 0
          }
          return { current, best }
        })()
        // 数字型 KPI 定义：[键, 终值, 格式器, 标题, 副标]
        const defs = [
          ['total', total, fmtCN, '累计 Token 数', `${allDays[0] ?? '—'} 起 ${allDays.length} 天`],
          ['peak', peak.value, fmtCN, '峰值 Token 数', peak.day ?? '—'],
          ['avg', daysWithUse.length === 0 ? 0 : Math.round(total / daysWithUse.length), fmtCN, '日均 Token 数', '按有记录天数'],
          ['calls', payload.totalCalls, fmtN, '模型调用次数', `${payload.models.length} 个模型`],
          ['streak', streak.current, (n) => `${String(n)} 天`, '当前连续天数', `历史最长 ${String(streak.best)} 天`],
        ]
        const box = el('kpis')
        box.innerHTML = defs
          .map(([, , , key, sub]) => `<div class="dsh-tu-kpi"><div class="v" data-kpi></div><div class="k">${esc(key)}</div><div class="s">${esc(sub)}</div></div>`)
          .join('')

        const writeStatic = () => {
          defs.forEach(([, num, format], index) => {
            box.children[index].querySelector('.v').textContent = format(num)
          })
        }
        /** 从 froms（缺省 0）滚动到各终值，逐卡错开 70ms。 */
        const runCountUp = (froms) => {
          defs.forEach(([key, num, format], index) => {
            const from = froms === null ? 0 : (froms[key] ?? 0)
            countUp(box.children[index].querySelector('.v'), from, num, {
              duration: froms === null ? 2800 : 1400,
              delay: froms === null ? index * 140 : 0,
              format,
            })
          })
        }

        const prev = state.kpiShown
        state.kpiShown = { total, peak: peak.value, avg: defs[2][1], calls: payload.totalCalls, streak: streak.current }
        if (prev === null && !state.kpiVisible) {
          // 还没进过视口：先摆终值占位，IntersectionObserver 触发时再从 0 滚
          writeStatic()
          kpiEntry = () => runCountUp(null)
        } else if (prev === null) {
          runCountUp(null)
        } else {
          // 数据更新（轮询/range 切换）：只在数值真变了的那几张卡上做短滚动
          const changed = Object.keys(state.kpiShown).some((key) => state.kpiShown[key] !== prev[key])
          if (changed) runCountUp(prev)
          else writeStatic()
        }
      }


      /* ── 热力图：SVG 方块格（每行 7 天，每列一周）── */
      /**
       * 热力图 + 读数条 + 明细表。
       *
       * 三种口径的着色规则：
       *   每日 — 只有当天有会话才着色
       *   每周 — 整周（周一~周日）同色，周内没有会话的天也跟这一周同色
       *   累计 — 从统计开始的第一次使用起逐日累加，当日消耗为 0 也照常显示
       */
      function renderHeat(payload, allDays) {
        const box = el('heat')
        const note = el('heatNote')
        const legend = el('heatLegend')
        if (allDays.length === 0) {
          box.innerHTML = emptyBlock('还没有可用的会话记录', '这个范围里还没有任何一次模型调用')
          note.textContent = ''
          legend.innerHTML = ''
          return
        }
        if (state.hmView === 'table') {
          // 表格视图：同一份数据的可朗读版本（知识库对热力图的要求是
          // 「不要只靠颜色传值」，并给出数据表 + 强度摘要的兜底）
          const peakTokens = Math.max(1, ...allDays.map((day) => {
            const bucket = payload.days[day] ?? {}
            let sum = 0
            for (const key of Object.keys(bucket)) sum += bucket[key].total
            return sum
          }))
          const rows = allDays
            .slice()
            .sort((a, b) => (a < b ? 1 : -1))
            .map((day) => {
              const bucket = payload.days[day] ?? {}
              let tokens = 0
              let calls = 0
              for (const key of Object.keys(bucket)) {
                tokens += bucket[key].total
                calls += bucket[key].calls ?? 0
              }
              const level = tokens === 0 ? '无' : tokens < peakTokens / 3 ? '低' : tokens < (peakTokens * 2) / 3 ? '中' : '高'
              return '<tr><td>' + esc(day) + '</td><td>' + fmtN(tokens) + '</td><td>' + fmtN(calls) + '</td><td>' + level + '</td></tr>'
            })
            .join('')
          const total = allDays.reduce((sum, day) => {
            const bucket = payload.days[day] ?? {}
            for (const key of Object.keys(bucket)) sum += bucket[key].total
            return sum
          }, 0)
          box.innerHTML =
            '<div class="dsh-tu-table-wrap"><table class="dsh-tu-table">' +
            '<caption>共 ' + allDays.length + ' 天有记录，合计 ' + fmtCN(total) + ' tokens</caption>' +
            '<thead><tr><th>日期</th><th>Token</th><th>调用</th><th>强度</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table></div>'
          note.textContent = '表格视图：数值可直接读取，也可用读屏逐行浏览'
          legend.innerHTML = ''
          return
        }

        const today = new Date()
        today.setHours(12, 0, 0, 0)
        const available = new Set(allDays)
        const width = Math.max(320, box.clientWidth || 900)
        const narrow = width < 520
        const cell = narrow ? 13 : 20
        const minGap = narrow ? 5 : 10
        let weeks = Math.max(8, Math.min(53, Math.floor(width / (cell + minGap))))
        let gap = weeks > 1 ? (width - weeks * cell) / (weeks - 1) : 0
        if (gap < minGap) {
          weeks = Math.max(8, weeks - 1)
          gap = weeks > 1 ? (width - weeks * cell) / (weeks - 1) : 0
        }
        const pitch = cell + gap
        const end = new Date(today)
        end.setDate(end.getDate() + (6 - ((end.getDay() + 6) % 7)))
        const start = new Date(end)
        start.setDate(start.getDate() - (weeks * 7 - 1))
        const keys = []
        const dayValue = new Map()
        const cursor = new Date(start)
        while (cursor <= end) {
          const key = fmtDate(cursor)
          keys.push(key)
          dayValue.set(key, available.has(key) ? (payload.days[key] ?? {}) : null)
          cursor.setDate(cursor.getDate() + 1)
        }

        // ── 每日基准 ──
        const dayTotal = new Map()
        const dayCalls = new Map()
        const dayModels = new Map()
        for (const key of keys) {
          const bucket = dayValue.get(key)
          if (bucket === null) continue
          const models = {}
          let sum = 0
          let calls = 0
          for (const model of Object.keys(bucket)) {
            models[model] = { total: bucket[model].total, calls: bucket[model].calls }
            sum += bucket[model].total
            calls += bucket[model].calls
          }
          dayTotal.set(key, sum)
          dayCalls.set(key, calls)
          dayModels.set(key, models)
        }

        // ── 周（周一~周日）聚合 ──
        const weekBlocks = []
        const weekOf = new Map()
        for (let index = 0; index < keys.length; index += 7) {
          const block = keys.slice(index, index + 7)
          const models = {}
          let total = 0
          let calls = 0
          for (const key of block) {
            const dayModelMap = dayModels.get(key)
            if (dayModelMap === undefined) continue
            for (const model of Object.keys(dayModelMap)) {
              models[model] = models[model] ?? { total: 0, calls: 0 }
              models[model].total += dayModelMap[model].total
              models[model].calls += dayModelMap[model].calls
              total += dayModelMap[model].total
              calls += dayModelMap[model].calls
            }
          }
          const info = { start: block[0], end: block[block.length - 1], total, calls, models, hasData: total > 0 }
          weekBlocks.push(info)
          for (const key of block) weekOf.set(key, info)
        }

        // ── 累计 ──
        const cumTotal = new Map()
        {
          let accumulated = 0
          for (const key of keys) {
            accumulated += dayTotal.get(key) ?? 0
            cumTotal.set(key, accumulated)
          }
        }

        /**
         * 一个格子的值与"是否着色"。
         *
         * 每周：整周共用同一个值，所以一周七天颜色一致（周内没有会话的天也跟
         * 这一周同色——它是这一周的格子）。
         * 累计：只要统计已经开始，当日消耗为 0 也照常显示累计值。
         */
        const cellOf = (key) => {
          if (state.hmMode === 'week') {
            const week = weekOf.get(key)
            return { value: week.total, hasData: week.hasData }
          }
          if (state.hmMode === 'cum') {
            const value = cumTotal.get(key)
            return { value, hasData: value > 0 }
          }
          const has = dayTotal.has(key)
          return { value: has ? dayTotal.get(key) : 0, hasData: has }
        }

        /** 悬浮/读数那句话：按口径给出"日期 + 消耗量"。 */
        const sentenceOf = (key) => {
          if (state.hmMode === 'week') {
            return `${fmtDateCN(key)}所在周，本周消耗 ${fmtTokensCN(weekOf.get(key).total)} Tokens`
          }
          if (state.hmMode === 'cum') {
            return `截至${fmtDateCN(key)}，累计消耗 ${fmtTokensCN(cumTotal.get(key) ?? 0)} Tokens`
          }
          return `${fmtDateCN(key)}，消耗 ${fmtTokensCN(dayTotal.get(key) ?? 0)} Tokens`
        }

        // 色阶按不同取值的排名分档，取值少时也能拉开层次
        const values = keys
          .map((key) => cellOf(key))
          .filter((info) => info.hasData && info.value > 0)
          .map((info) => info.value)
          .sort((a, b) => a - b)
        const distinct = [...new Set(values)]
        const levelOf = new Map()
        distinct.forEach((value, index) => {
          const level = distinct.length === 1 ? 1 : 1 + Math.round((index / (distinct.length - 1)) * 3)
          levelOf.set(value, level)
        })
        const level = (value) => {
          if (value <= 0) return 0
          const exact = levelOf.get(value)
          if (exact !== undefined) return exact
          let best = 1
          for (const [item, lv] of levelOf) if (item < value && lv > best) best = lv
          return best
        }
        const accent = 'var(--tu-accent,#3b82f6)'
        const emptyFill = 'currentColor'
        const emptyOpacity = 0.13
        const levelOpacity = [0.32, 0.55, 0.8, 1]

        const columns = Math.ceil(keys.length / 7)
        const gridWidth = columns * pitch - gap
        const gridHeight = 7 * pitch - gap
        let svg = `<svg class="dsh-tu-svg" width="${gridWidth}" height="${gridHeight}" viewBox="0 0 ${gridWidth} ${gridHeight}">`
        keys.forEach((key, index) => {
          const column = Math.floor(index / 7)
          const row = index % 7
          const x = (column * pitch).toFixed(1)
          const y = (row * pitch).toFixed(1)
          const day = new Date(`${key}T12:00:00`)
          if (day > today) return
          const info = cellOf(key)
          if (!info.hasData) {
            svg += `<rect class="cell" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="4" fill="${emptyFill}" fill-opacity="${emptyOpacity}"/>`
            return
          }
          const grade = level(info.value)
          svg += `<rect class="cell" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="4" fill="${accent}" fill-opacity="${levelOpacity[Math.max(0, grade - 1)]}" data-day="${key}" data-value="${info.value}"/>`
        })
        svg += '</svg>'
        // 月份标签
        let months = `<svg class="dsh-tu-svg" width="${gridWidth}" height="18" viewBox="0 0 ${gridWidth} 18" style="margin-top:6px">`
        const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
        let previous = -1
        let lastLabel = -99
        for (let column = 0; column < columns; column += 1) {
          const key = keys[column * 7]
          const month = new Date(`${key}T12:00:00`).getMonth()
          const isNew = month !== previous
          previous = month
          const show = isNew && column - lastLabel >= 2
          if (show) {
            lastLabel = column
            months += `<text x="${(column * pitch).toFixed(1)}" y="13">${monthNames[month]}</text>`
          }
        }
        months += '</svg>'
        box.innerHTML = `<div class="dsh-tu-heat-scroll">${svg}${months}</div>`

        const modeHint = state.hmMode === 'week'
          ? '每格 = 该周（周一~周日）消耗'
          : state.hmMode === 'cum'
            ? '每格 = 截至当天的累计消耗'
            : '每格 = 当天消耗'
        note.innerHTML = `<i></i>${esc(modeHint)} · 记录起始 <b>${esc(allDays[0])}</b> · 已有 <b>${String(allDays.length)}</b> 天 · 灰色为未采集`
        const swatches = levelOpacity
          .map((opacity) => `<span class="b" style="background:${accent};opacity:${opacity}"></span>`)
          .join('')
        legend.innerHTML = `<span>少</span>${swatches}<span>多</span><span style="width:10px"></span>`
          + `<span><span class="b" style="display:inline-block;background:currentColor;opacity:${emptyOpacity};vertical-align:-1px;margin-right:4px"></span>无会话记录</span>`

        // ── 悬浮提示：一句话 ──
        const tip = el('heatTip')
        const card = box.closest('.dsh-tu-card')
        const showTip = (event) => {
          const key = event.currentTarget.dataset.day
          tip.innerHTML = `<div class="t">${esc(sentenceOf(key))}</div>`
          tip.style.display = 'block'
          const rect = card.getBoundingClientRect()
          let left = event.clientX - rect.left + 14
          let top = event.clientY - rect.top + 10
          if (left + tip.offsetWidth > rect.width - 8) left = event.clientX - rect.left - tip.offsetWidth - 14
          tip.style.left = `${Math.max(4, left)}px`
          tip.style.top = `${Math.max(4, top)}px`
        }
        for (const rect of box.querySelectorAll('rect.cell[data-day]')) {
          rect.addEventListener('mouseenter', showTip)
          rect.addEventListener('mousemove', showTip)
          rect.addEventListener('touchstart', (event) => {
            const touch = event.touches[0]
            showTip({ currentTarget: rect, clientX: touch.clientX, clientY: touch.clientY })
          }, { passive: true })
          rect.addEventListener('mouseleave', () => { tip.style.display = 'none' })
          rect.addEventListener('touchend', () => { tip.style.display = 'none' })
        }

      }

      /* ── 折线图：连续时间轴 + 平滑样条 ── */
      /**
       * 每日 Token 总消耗趋势。
       *
       * 只画一条线：每天的总消耗。模型明细不画成系列（十几条线既看不清也点不准），
       * 放进悬停提示里——那才是"这一天到底花在哪"的答案。
       */
      function renderLine(payload, days) {
        const box = el('line')
        const tip = el('lineTip')
        const axis = continuousDays(days, state.range)
        if (axis.length === 0) {
          box.innerHTML = emptyBlock('该范围内没有记录', '换一个时间范围，或点重新读取')
          return
        }

        // 每天的总消耗
        const daily = axis.map((day) => {
          const bucket = payload.days[day]
          let sum = 0
          if (bucket !== undefined) for (const key of Object.keys(bucket)) sum += bucket[key].total
          return sum
        })

        const width = Math.max(320, box.clientWidth || 900)
        const height = 340
        const pad = { left: 56, right: 18, top: 16, bottom: 36 }
        const innerWidth = width - pad.left - pad.right
        const innerHeight = height - pad.top - pad.bottom
        const max = Math.max(...daily)
        const ticks = niceTicks(max === 0 ? 1 : max, 4)
        const top = Math.max(max, ticks[ticks.length - 1]) * 1.12
        const baseline = pad.top + innerHeight
        const xOf = (index) => pad.left + (axis.length === 1 ? innerWidth / 2 : (index / (axis.length - 1)) * innerWidth)
        const yOf = (value) => Math.max(pad.top, Math.min(baseline, baseline - (value / top) * innerHeight))
        const accent = 'var(--tu-accent,#3b82f6)'

        let svg = `<svg class="dsh-tu-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
        svg += `<defs><clipPath id="dsh-tu-clip"><rect x="${pad.left}" y="${pad.top - 4}" width="${innerWidth}" height="${innerHeight + 4}"/></clipPath></defs>`
        for (const tick of ticks) {
          svg += `<line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${yOf(tick)}" y2="${yOf(tick)}"/>`
          svg += `<text class="tick" x="${pad.left - 8}" y="${yOf(tick) + 4}" text-anchor="end">${fmtCN(tick)}</text>`
        }
        svg += `<line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${baseline}" y2="${baseline}"/>`
        const maxTicks = Math.max(2, Math.floor(innerWidth / 78))
        const step = Math.max(1, Math.ceil(axis.length / maxTicks))
        const lastIndex = axis.length - 1
        axis.forEach((day, index) => {
          const isStep = index % step === 0
          const isLast = index === lastIndex
          if (!isStep && !isLast) return
          if (isStep && !isLast && lastIndex - index < step * 0.9) return
          const label = innerWidth < 560
            ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`
            : `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`
          const anchor = index === 0 ? 'start' : index === lastIndex ? 'end' : 'middle'
          const shift = index === 0 ? -2 : index === lastIndex ? 2 : 0
          svg += `<text class="tick" x="${(xOf(index) + shift).toFixed(1)}" y="${height - 12}" text-anchor="${anchor}">${label}</text>`
        })

        // 面积 + 曲线（单调插值 + 渐变填充：峰值实、谷值淡，不越过基线）
        const points = axis.map((day, index) => ({ x: xOf(index), y: yOf(daily[index]) }))
        const line = spline(points, { top: pad.top, bottom: baseline })
        const area = `${line} L${points[points.length - 1].x.toFixed(1)},${baseline} L${points[0].x.toFixed(1)},${baseline} Z`
        svg += `<defs><linearGradient id="dsh-tu-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${accent}" stop-opacity="0.9"/>
          <stop offset="70%" stop-color="${accent}" stop-opacity="0.45"/>
          <stop offset="100%" stop-color="${accent}" stop-opacity="0.22"/>
        </linearGradient></defs>`
        svg += `<path d="${area}" fill="url(#dsh-tu-fade)" fill-opacity="0.28" stroke="none" clip-path="url(#dsh-tu-clip)"/>`
        svg += `<path d="${line}" fill="none" stroke="${accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#dsh-tu-clip)"/>`
        svg += `<line class="cross" id="dsh-tu-cross" x1="0" x2="0" y1="${pad.top}" y2="${baseline}" visibility="hidden"/>`
        svg += `<circle id="dsh-tu-dot" cx="0" cy="0" r="4.5" fill="${accent}" stroke="var(--tu-panel,#fff)" stroke-width="2" visibility="hidden"/>`
        svg += `<rect x="${pad.left}" y="${pad.top}" width="${innerWidth}" height="${innerHeight}" fill="transparent" pointer-events="all" id="dsh-tu-hit"/>`
        svg += '</svg>'
        box.innerHTML = svg

        // 峰值
        let peakValue = 0
        let peakDay = null
        axis.forEach((day, index) => {
          if (daily[index] > peakValue) {
            peakValue = daily[index]
            peakDay = day
          }
        })
        const touch = window.matchMedia('(max-width:760px)').matches
        el('chartHint').textContent = `${peakValue > 0 ? `峰值 ${fmtCN(peakValue)} · ${peakDay} · ` : ''}${touch ? '点按查看当日各模型明细' : '悬停查看当日各模型明细'}`

        const svgNode = box.querySelector('svg')
        const hit = svgNode.querySelector('#dsh-tu-hit')
        const move = (event) => {
          const rect = svgNode.getBoundingClientRect()
          const px = (event.clientX - rect.left) * (width / rect.width)
          let index = Math.round(((px - pad.left) / innerWidth) * (axis.length - 1))
          index = Math.max(0, Math.min(axis.length - 1, index))
          const day = axis[index]
          const cx = xOf(index)
          const cross = svgNode.querySelector('#dsh-tu-cross')
          cross.setAttribute('x1', cx)
          cross.setAttribute('x2', cx)
          cross.setAttribute('visibility', 'visible')
          const dot = svgNode.querySelector('#dsh-tu-dot')
          dot.setAttribute('cx', cx)
          dot.setAttribute('cy', yOf(daily[index]))
          dot.setAttribute('visibility', 'visible')

          // 当天各模型的消耗明细
          const bucket = payload.days[day] ?? {}
          const rows = Object.keys(bucket)
            .map((key) => ({
              name: displayName(key),
              value: bucket[key].total,
              calls: bucket[key].calls,
              color: COLORS.get(key) ?? othersColor(),
            }))
            .sort((a, b) => b.value - a.value)
          const total = rows.reduce((acc, row) => acc + row.value, 0)
          const calls = rows.reduce((acc, row) => acc + row.calls, 0)

          let html
          if (rows.length === 0) {
            html = '<div class="row"><span class="m">该日无会话记录</span></div>'
          } else {
            // 模型全列；多到离谱时才合并尾巴
            const LIMIT = 20
            const head = rows.slice(0, LIMIT)
            const tail = rows.slice(LIMIT)
            html = head
              .map((row) => `<div class="row"><span class="m"><i style="background:${row.color}"></i>${esc(row.name)}</span><span class="v">${fmtTokensCN(row.value)}</span></div>`)
              .join('')
            if (tail.length > 0) {
              const sum = tail.reduce((acc, row) => acc + row.value, 0)
              html += `<div class="row"><span class="m">其余 ${String(tail.length)} 个模型</span><span class="v">${fmtTokensCN(sum)}</span></div>`
            }
            html += `<div class="row total"><span class="m">合计</span><span class="v">${fmtTokensCN(total)}</span></div>`
            if (calls > 0) html += `<div class="row"><span class="m">调用</span><span class="v">${fmtN(calls)} 次</span></div>`
          }
          tip.innerHTML = `<div class="t">${esc(fmtDateCN(day))}</div>${html}`
          tip.style.display = 'block'
          const card = box.closest('.dsh-tu-card')
          const cardRect = card.getBoundingClientRect()
          const svgRect = svgNode.getBoundingClientRect()
          const left = svgRect.left - cardRect.left + (cx / width) * svgRect.width
          const tipWidth = tip.offsetWidth
          let tipLeft = left + 14
          if (tipLeft + tipWidth > cardRect.width - 10) tipLeft = left - tipWidth - 14
          tip.style.left = `${Math.max(6, tipLeft)}px`
          tip.style.top = `${Math.max(6, svgRect.top - cardRect.top + 6)}px`
        }
        const hide = () => {
          tip.style.display = 'none'
          svgNode.querySelector('#dsh-tu-cross').setAttribute('visibility', 'hidden')
          svgNode.querySelector('#dsh-tu-dot').setAttribute('visibility', 'hidden')
        }
        hit.addEventListener('mousemove', move)
        hit.addEventListener('touchstart', (event) => {
          const touch = event.touches[0]
          move({ clientX: touch.clientX, clientY: touch.clientY })
        }, { passive: true })
        hit.addEventListener('mouseleave', hide)
        hit.addEventListener('touchend', () => { setTimeout(hide, 1800) })
      }

      function renderRank(payload, days, ranked) {
        const box = el('rank')
        if (ranked.length === 0) {
          box.innerHTML = emptyBlock('该范围内没有记录', '换一个时间范围，或点重新读取')
          return
        }
        const max = ranked[0][1].total
        // 数据签名：轮询刷新但数值没变时，不重播动画，直接定格
        const sig = ranked.map(([key, value]) => `${key}:${value.total}:${value.calls}`).join('|')
        const sameData = state.rankSig === sig
        state.rankSig = sig

        box.innerHTML = ranked
          .map(([key, value], rankIndex) => {
            const info = splitName(key)
            const color = COLORS.get(key) ?? othersColor()
            return `<div class="rrow" data-model="${esc(key)}">
              <div class="idx">${rankIndex + 1}</div>
              <div class="name" title="${esc(key)}"><i style="background:${color}"></i>${esc(info.short)} <span class="pv">· ${esc(info.provider)}</span></div>
              <div class="bar"><i style="width:0%;background:${color}"></i></div>
              <div class="val"></div>
            </div>`
          })
          .join('')

        if (sameData) {
          for (const row of box.querySelectorAll('.rrow')) {
            const key = row.dataset.model
            const frac = state.rankShown.get(key) ?? 0
            const fill = row.querySelector('.bar i')
            const val = row.querySelector('.val')
            fill.style.width = `${(frac * 100).toFixed(2)}%`
            // 还没入场时保持 0，等弹簧起跑再 lockstep
            const match = ranked.find(([k]) => k === key)
            val.textContent = !state.rankVisible || match === undefined
              ? (state.rankVisible ? '' : '0')
              : `${fmtCN2(match[1].total)} · ${fmtN(match[1].calls)} 次`
          }
          return
        }

        /** 从当前记录的比例弹到各行的新目标，逐行错开。 */
        const runSpring = () => {
          box.querySelectorAll('.rrow').forEach((row, index) => {
            const key = row.dataset.model
            const value = ranked[index][1]
            const to = max > 0 ? value.total / max : 0
            const from = state.rankShown.get(key) ?? 0
            state.rankShown.set(key, to)
            springBar(row.querySelector('.bar i'), row.querySelector('.val'), from, to, {
              total: value.total,
              calls: value.calls,
              // 慢放 2×（调参台定稿：stiffness 20 / damping 4.9，ζ≈0.55 回弹手感不变）
              stiffness: 20,
              damping: 4.9,
              // 顶部条先弹、往下逐行错开，节奏更像依次“称重”
              delay: index * 90,
            })
          })
        }

        // 排行卡在首屏之外：屏外播动画等于没播（用户滚到时早已结束，轮询又不
        // 会重播）。所以屏外只把条压在 0、读数写 0，等 IntersectionObserver
        // 报告进入视口再弹；进入过之后每次数据变化都直接播。
        if (!state.rankVisible) {
          for (const row of box.querySelectorAll('.rrow')) {
            row.querySelector('.val').textContent = '0'
          }
          rankEntry = runSpring
          return
        }

        rankEntry = null
        runSpring()
      }

      function refresh() {
        void load()
      }

      // 空态/错误态的动作按钮：委托一次，重绘后无需重新绑定
      root.addEventListener('click', (event) => {
        const act = event.target.closest('[data-act="refresh"]')
        if (act === null) return
        state.error = null
        root.setAttribute('aria-busy', 'true')
        renderSkeleton(el('kpis'), el('heat'), el('line'), el('rank'))
        refresh()
      })

      load()
      const timer = window.setInterval(refresh, REFRESH_MS)

      // 挂载瞬间布局可能还没稳定（clientWidth 偏小会把格子算小再被拉伸），
      // 所以容器尺寸一变就重画，而不是只听 window.resize。
      let resizeTimer
      const scheduleRender = () => {
        window.clearTimeout(resizeTimer)
        resizeTimer = window.setTimeout(() => { if (state.payload !== null) render() }, 140)
      }
      const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleRender) : null
      if (observer !== null) observer.observe(root)
      window.addEventListener('resize', scheduleRender)

      return {
        destroy() {
          window.clearInterval(timer)
          window.clearTimeout(resizeTimer)
          if (refetchTimer !== null) window.clearTimeout(refetchTimer)
          cancelAllAnims()
          if (revealIo !== null) revealIo.disconnect()
          if (observer !== null) observer.disconnect()
          window.removeEventListener('resize', scheduleRender)
        },
      }
    }

    /* ───────────────── React 外壳 ───────────────── */

    /**
     * 设置页里的 React 组件。
     *
     * 图表部分是手写 DOM + SVG（没有 JSX，也就不需要打包器），React 只负责
     * 给宿主一个挂载点。
     */
    function TokenUsagePage() {
      const ref = React.useRef(null)
      React.useEffect(() => {
        const node = ref.current
        if (node === null) return undefined
        const controller = mountDashboard(node)
        return () => { controller.destroy() }
      }, [])
      return React.createElement(
        'div',
        { className: 'dsh-tu-page' },
        React.createElement('div', { ref, className: 'dsh-tu' }),
      )
    }

    /** 侧边栏里的图标：三根柱子，跟随主题色。 */
    function TokenUsageIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 18
      return React.createElement(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': 'true',
          style: { display: 'block' },
        },
        React.createElement('rect', { x: 3, y: 13, width: 4, height: 8, rx: 1.2, fill: 'currentColor', opacity: 0.5 }),
        React.createElement('rect', { x: 10, y: 8, width: 4, height: 13, rx: 1.2, fill: 'currentColor', opacity: 0.75 }),
        React.createElement('rect', { x: 17, y: 3, width: 4, height: 18, rx: 1.2, fill: 'currentColor' }),
      )
    }

    /**
     * 客户端插件入口。
     *
     * @param {object} ctx - 客户端插件上下文。
     */
    function apply(ctx) {
      ensureStyle()
      // 侧边栏图标：宿主负责按钮与标题，这里只提供图标
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 30,
            label: () => 'Token 用量',
          },
          TokenUsageIcon,
        ),
      )
      // 点开后的中央面板：主面板按 id 派发
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
          },
          TokenUsagePage,
        ),
      )
    }

    exports.name = 'token-usage'
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
