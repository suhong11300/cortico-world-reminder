# 提醒 · cortico-world-reminder

[![npm](https://img.shields.io/npm/v/cortico-world-reminder?label=npm&color=cb3837)](https://www.npmjs.com/package/cortico-world-reminder)
[![license](https://img.shields.io/npm/l/cortico-world-reminder?color=blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A5%2022-43853d)](https://nodejs.org)
[![world api](https://img.shields.io/badge/cortico%20world%20api-6-8b5cf6)](https://github.com/Pal-AI-Lab/cortico)

在对话中按设定时间提醒事项。支持重复提醒、提前预告与延后；离线期间错过的提醒在下次启动时补发。

- **主动叫醒**：到点由 World 推事件唤醒会话，不靠模型自己轮询时间。
- **不会丢**：提醒存本机文件，关机期间到点的条目在下次启动时补投一次。
- **提过不等于办过**：投递只推事件，状态只由 `reminder_done` / `reminder_cancel` / `reminder_snooze` 改。
- **坏了也能起**：存储文件读不出来时改名留档并重建，World 照常挂载。

*Cortico World · `kind: world` · `api: 6` · `tags: companion` · MIT · 26 项单测通过、契约校验通过*

## 目录

- [为什么需要它](#为什么需要它)
- [安装](#安装)
- [装完自检](#装完自检)
- [工具](#工具)
- [事件](#事件)
- [配置](#配置)
- [行为细节](#行为细节)
- [数据与落盘](#数据与落盘)
- [环境段](#环境段)
- [验证到哪一级](#验证到哪一级)
- [已知边界](#已知边界)
- [文件结构](#文件结构)
- [许可](#许可)

## 为什么需要它

| 没有它 | 有它 |
| --- | --- |
| 模型不知道「20 分钟后」是什么时候，只能等你回来再问一遍 | 你一句话记下，到点会话被真的叫醒 |
| 关掉 Coopanion 的那段时间等于提醒消失 | 启动时先补投一次，错过的条目照样送到 |
| 说「提过了」却没有可追踪的条目 | 每条提醒有 id、状态、已提醒次数，能列、能延后、能取消 |

## 安装

面板安装（推荐）：

1. 打开 Coopanion WebUI（端口以 `config.json` 的 `web.port` 为准，默认 `17788`），进入**高级模式 → 扩展**。
2. 在扩展市场搜 `cortico-world-reminder`，或在**手动安装**里选「从 npm 安装」填包名。
3. 安装完成后重启 Coopanion：扩展在宿主启动时扫描，新装的处于 `pending-restart`。
4. 进 **World 总览**，打开「提醒」；面板路由是 `#/provider/world%3Areminder`。
5. 在 World 面板里按需改 `trigger` / `leadMinutes` / `repeatMinutes` 等，全部热改，不用重启。

手动安装（开发阶段）写在文末[文件结构](#文件结构)之后的排障附录里。

## 装完自检

| 检查 | 通过标准 |
| --- | --- |
| 扩展列表 | `cortico-world-reminder` 显示已加载，没有红色警告 |
| 工具可见 | 会话里能列出 `reminder_add` / `reminder_list` / `reminder_done` / `reminder_cancel` / `reminder_snooze` |
| 冒烟 | 让模型记一条 2 分钟后的提醒，`reminder_list` 能看到它，到点收到 `reminder.due` |
| 落盘 | `<dataDir>/reminder/reminders.json` 存在且 `version` 为 1 |

## 工具

| 工具 | 参数 | 作用 |
| --- | --- | --- |
| `reminder_add` | `text`、`in_minutes` 或 `at`（二选一）、`repeat_minutes` | 记一条提醒；`at` 必须是带时区偏移的 ISO 8601，且指向未来 |
| `reminder_list` | `include_closed` | 按到点时间列出待提醒，可附最近 5 条已结束 |
| `reminder_done` | `id` | 标成已处理，停止重复 |
| `reminder_cancel` | `id` | 取消，不记成已处理 |
| `reminder_snooze` | `id`、`minutes` | 往后推，并清掉已提醒次数 |

## 事件

| 事件 | 何时 | origin |
| --- | --- | --- |
| `reminder.ready` | 挂载完成；text 带待提醒条数与最近一条 | `internal` |
| `reminder.due` | 到点、提前预告或需要重复提醒；meta 带 `reminderId`、`at`、`firedCount`、`early` | `internal` |

正文由固定模板加你自己写下的话组成，没有第三方内容，所以 `origin` 一律是 `internal`。

## 配置

全部是 `worlds.reminder.*`，改完即时生效（`x-hot`）。

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `trigger` | `flush` | 到点事件的投递方式：`flush` 等本轮结束，`preempt` / `interrupt` 更急 |
| `maxPending` | `20` | 未完成提醒上限，满了 `reminder_add` 直接拒绝 |
| `leadMinutes` | `0` | 提前多少分钟预告；只对尚未提醒过的条目生效 |
| `repeatMinutes` | `0` | 到点后没人处理的重复间隔；0 表示只提一次 |
| `maxRepeats` | `3` | 同一条最多重复几次 |

`enabled` 由部署决定，定义里恒为 `false`，不在面板暴露；是否启用请改 `config.json` 的 `worlds.reminder.enabled`。

## 行为细节

- 每 15 秒扫一次到期项（判定精度到分钟），计时器 `unref`，不阻止进程退出。
- 挂载顺序是「先建计时器、再推 `reminder.ready`」：推送失败只记日志并在 2 秒后补投一次，不会因为宿主初始化未完成就把整个 World 卡死。
- 一条提醒一次只投一条事件；重复次数由 `firedCount` 与 `maxRepeats` 共同封顶。
- 投递不改状态：只有三个写工具会动 `pending` / `done` / `cancelled`。
- 已结束的旧记录最多留 200 条，超出在每次写入时裁掉。

## 数据与落盘

| 项 | 位置 |
| --- | --- |
| 提醒文件 | `<dataDir>/reminder/reminders.json` |
| 写入方式 | 先写 `.tmp` 再 `rename`，避免半截文件 |
| 坏文件 | 读不出来时改名成 `.bad-<时间>` 留档并重建空文件 |
| id 形态 | `r<序号36进制>-<创建时间36进制>` |

## 环境段

World 往系统前缀的环境段注入三行，占位符由 `envPromptVars()` 实时求值：

```text
{{reminder.now}}
{{reminder.summary}}
{{reminder.next}}
```

分别对应当前时间、待提醒概况、最近一条的内容与到点时间。

## 验证到哪一级

| 层 | 做了什么 | 能证明 | 不能证明 |
| --- | --- | --- | --- |
| 静态 | `corepack pnpm typecheck` | 类型与模块边界自洽 | 运行时行为 |
| 单测 | `corepack pnpm test`，26 项（store 11 + world 15） | 到期判定、重复封顶、坏文件重建、挂载容错在假宿主与假时钟下成立 | 真实宿主里的挂载时序 |
| 契约 | `describe:extension` / `check:extension` | 工具与事件声明、配置键、提示词占位符符合 World api 6 | 面板点选后的实际体验 |
| 未做 | 跨时区夏令时边界、系统休眠唤醒、长时间运行 | — | 这些场景仍需实战观察 |

## 已知边界

- 提醒只存在本机，不跨设备同步。
- 依赖进程存活：Coopanion 没开的时候不会弹出任何系统通知，只在下次启动补投。
- 到点判定按分钟粒度，不做秒级调度。
- 不处理系统时钟回拨，把时间调早可能让重复提醒延后一次。
- 存储是单文件原子替换，没有跨进程写锁；同一进程内的扫描与工具写入是串行的。

## 文件结构

| 文件 | 内容 |
| --- | --- |
| `src/definition.ts` | `WorldDefinition`：id、label、默认配置、`create()`、`describe` |
| `src/config.ts` | 配置段类型、默认值、WebUI 配置组 |
| `src/store.ts` | 落盘存储与到期判断的纯函数 |
| `src/time.ts` | ISO 8601 解析与按时区显示 |
| `src/world.ts` | `World` 实现：五个工具、两个事件、轮询节拍、`webUi()` |
| `src/ENV_PROMPT.md` | 环境提示词模板 |
| `tests/` | store 与 world 两层测试，`helpers/fake-host.ts` 是记录推送的假宿主 |

排障附录（只在开发本机装时用）：把包目录放进 Coopanion 的 `data/extensions/package.json` 依赖里写成 `link:<源码绝对路径>`，在 `data/home/companion/config.json` 的 `worlds.reminder` 写 `enabled: true`，再重启 Coopanion。

## 许可

MIT。
