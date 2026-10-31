# dsh-token-usage

统计 DSH 每天消耗的 Tokens，按模型分系列展示趋势与日历热力图。

## 安装

从 GitHub 仓库地址安装（市场里也可直接搜包名）：

```
https://github.com/zhangyongshuai56-hub/dsh-token-usage
```

npm 包名是 `@zhangyongshuai56-hub/dsh-token-usage`（`dsh-token-usage` 已被他人占用，故加 scope）。

也可以本地软链开发（见文末「开发」）。安装后在设置里打开「Token 用量」面板即可。

## 数据从哪来

DSH 没有现成的按模型 token 台账。每条模型响应把用量写进会话文件的
`assistant/message` 事件：

```json
{"type":"assistant/message","time":1791555004268,
 "data":{"usage":{"inputTokens":7636,"outputTokens":505,
                  "cacheReadTokens":0,"cacheWriteTokens":0,"totalTokens":8141}}}
```

模型归属在同一会话的 `request/header`（`config.provider` / `config.model`）里，
时间按本地时区归日。宿主侧扫描 `~/.dsh/sessions/**/session.v4.jsonl.zstd`
（zstd 多帧，每帧独立解压后拼接）聚合出「天 × 模型」的用量表。

一次全量扫描约 0.7 秒（40 个会话文件 / 38 MB），所以**不能**把它压在用户点开
面板的那一次请求上。

## 加载性能

点击后面板要立刻出数字，做法是两层：

**服务端 · stale-while-revalidate**

- 插件装载时后台预热一次快照，用户第一次点开时通常已经就绪；
- 快照过期（30 秒 TTL）时，接口**先返回旧数据**（立刻出数字），同时在后台
  重扫，响应头 `x-token-usage-stale: 1` 标记「这是旧的」；
- 后台扫描走异步驱动，每处理几个文件就把事件循环让出去，不卡宿主进程。

**服务端 · 增量扫描**

会话文件是追加写的，所以历史部分的聚合结果永远不变。按文件记住「消费到第几个
字节 + 截至该处的聚合结果」，再次扫描只解压新增的那几帧：

| 场景 | 全量 | 增量 |
| --- | --- | --- |
| 冷扫描（首次 / 文件被改写） | 735 ms | 735 ms |
| 稳态（文件没变） | 735 ms | **1-2 ms** |
| 当前会话又写了几条 | 735 ms | **3 ms** |

另外扫描时先用正则挑出与统计相关的事件行（`assistant/message`、
`request/header`、`request/context`），其余 85% 的行不交给 `JSON.parse`；
预筛没挑中任何一行时退回逐行全解析，避免日志格式变化导致统计漏数。

**浏览器端**

拿到 `x-token-usage-stale: 1` 时，页面会在 1.2 秒后自动补取一次，把刚刷新的
数据换上——用户全程不用等。

## 界面

设置 → **Token 用量**：

- 顶部 5 格大数字：累计 / 峰值 / 日均 / 调用次数 / 当前连续天数
- **Token 活动**：整年日历热力图（每日 / 每周 / 累计三种口径），方块格、颜色深浅
  表示消耗量，悬停或点按出当日各模型明细
- **每日 Token 趋势图**：连续日历轴（无记录的日期计 0，线不断、空档宽度是真实
  天数），每模型一条系列，只画用量前 5 名、其余合并为「其他」，悬停出明细
- **模型排行**：范围内全部模型

配色走宿主 token（`--dsw-alias-*`），跟随 DSH 深浅主题。

## 接口

```
GET /dsh-token-usage/usage
→ { days: { "YYYY-MM-DD": { "provider/model": { total, input, output, calls } } },
    models: string[], totalTokens, totalCalls, scannedAt, sessions }

响应头 x-token-usage-stale: 0 | 1   # 1 = 这是旧快照，服务端正在后台重扫
```

## 开发

插件是本地软链安装的（`link:` 协议），改完源码重启 DSH 即可生效：

```sh
node --check lib/index.js && node --check lib/aggregate.js && node --check lib/client.js
```

`lib/client.js` 手写成 `window.__ModuleLoader__` 工厂，没有构建步骤——图表是
手写 DOM + SVG，不需要 JSX，也就不需要打包器。

## 2026-11-01 UI/UX 修复（审计后落地）

按 `ui-ux-pro-max` 的十条优先级审计后修掉的部分（未采纳的两条见末尾「已知未做」）：

| 项 | 问题 | 修法 |
|---|---|---|
| 配色可读性 | 黄金角色板在白底有 19/31 个系列色低于 4.5:1，最差 **1.70:1**（画了看不见） | 色相不动，明度按主题夹到 ≥4.5:1（`readableColor`）；兜底灰同步可读（5.98:1 / 7.28:1）。实测 31/31 达标 |
| 主按钮 | 白字压 `#3b82f6` 只有 3.68:1 | 底色换成按主题夹过的 `--tu-accent`，文字色 `--tu-on-accent` 随之反转 |
| 首帧 | 请求返回前是空白容器（CLS + 无反馈） | 等尺寸骨架 + `aria-busy`，数据到达不跳动；失败态给「重试」按钮 |
| 空态 | 只有一句话、没有出口 | 文案 + 副文案 + 「重新读取」按钮（事件委托，重绘无需重绑） |
| 空态对比 | `--tu-t3` 3.25:1 | 正文改 `--tu-t2`（7.73:1），`--tu-t3` 只留给装饰 |
| 数据只靠颜色 | 热力图只有色阶，读不到具体数值 | 新增**表格视图**（日期 / Token / 调用 / 强度），与热力图一键切换 |
| 排行名次 | 只靠颜色和条长 | 增加序号列（1…n） |
| 触摸目标 | 按钮 28px | 32px 起，`@media (hover:none)` 提到 44px |
| 语义/文案 | 页面标题与卡片标题同为 h3；头部用全数字、KPI 用万/亿；`· anim v2` 调试残留 | h2 / 统一 `fmtCN` / 删除残留 |
| 数字精度 | 2.96 亿被四舍五入成「3亿」 | 亿保留两位再去尾零 |

**已知未做**（按使用方决定不采纳）：图表键盘可达（`tabindex` + `aria-label` + 方向键）、
热力图触摸后提示常驻。表格视图让数值可读，但没有键盘焦点路径。

**顺带修掉的 harness 缺陷**：`harness/index.html` 的深色预览只换了 `body` 背景、
没换 `--dsw-alias-*` 令牌，深色截图里文字全是黑的（误判为"插件深色不可用"）。
