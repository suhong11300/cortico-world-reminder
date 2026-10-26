# cortico-world-reminder

Owner: `src/definition.ts`

本地提醒 World:提醒存在本机,到点由 World 主动推事件叫醒会话,不需要模型轮询。
用户说「20 分钟后提醒我」时就记一条;到点后事件里带着正文与设定时间,处理完用 `reminder_done` 收尾。

## 装进 Coopanion

1. 包放进 `<Coopanion>/data/extensions` 的 dependencies(`link:<源码绝对路径>` 或版本号)。
2. 在 `<Coopanion>/data/home/companion/config.json` 的 `worlds.reminder` 段写 `{ "enabled": true }`。
3. 重启 Coopanion:宿主启动时扫描扩展,新装的是 pending-restart。
4. 面板地址 `http://127.0.0.1:17788`,World 页路由 `#/provider/world%3Areminder`。

数据落在 `<dataDir>/reminder/reminders.json`,先写 `.tmp` 再改名;读到坏文件时改名成 `.bad-<时间>` 并重建,不会让 World 起不来。

## 工具

| 工具 | 参数 | 作用 |
|---|---|---|
| `reminder_add` | `text`,`in_minutes` 或 `at`(二选一),`repeat_minutes` | 记一条提醒;`at` 必须是带时区偏移的 ISO 8601,future only |
| `reminder_list` | `include_closed` | 按到点时间列出待提醒,可附最近 5 条已结束 |
| `reminder_done` | `id` | 标成已处理,停止重复 |
| `reminder_cancel` | `id` | 取消,不记成已处理 |
| `reminder_snooze` | `id`,`minutes` | 往后推,并清掉已提醒次数 |

## 事件

| 事件 | 何时 | origin |
|---|---|---|
| `reminder.ready` | 挂载完成,text 里带待提醒条数与最近一条 | `internal` |
| `reminder.due` | 到点、提前预告或需要重复提醒;meta 带 `reminderId`、`at`、`firedCount`、`early` | `internal` |

正文一律是固定模板 + 用户自己用工具写下的文字,没有第三方内容,所以 origin 用 `internal`。

## 配置(`worlds.reminder.*`,全部热改)

| 键 | 默认 | 作用 |
|---|---|---|
| `trigger` | `flush` | 到点事件的投递方式:`flush` 等本轮结束,`preempt` / `interrupt` 更急 |
| `maxPending` | `20` | 未完成提醒上限,满了 `reminder_add` 直接拒绝 |
| `leadMinutes` | `0` | 提前多少分钟预告;0 表示只在到点提醒 |
| `repeatMinutes` | `0` | 到点后没人处理的重复间隔;0 表示只提一次 |
| `maxRepeats` | `3` | 同一条最多重复几次 |

## 行为细节

- 每 15 秒扫一次到期项(精度到分钟),`start()` 时先补投一次,关机错过的提醒不会丢。
- 一条提醒一次只投一条事件;重复提醒的次数由 `firedCount` 与 `maxRepeats` 共同封顶。
- 投递后不会自动标完成:只有 `reminder_done` / `reminder_cancel` / `reminder_snooze` 会改状态,避免把「提过」当成「办过」。
- 已结束的旧记录最多留 200 条,再多的在每次写入时裁掉。

## 验证

`@bash
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test                      # 24 项:store 11 + world 13
cd ../../cortico
corepack pnpm describe:extension <这个包的绝对路径>
corepack pnpm check:extension <这个包的绝对路径>
`@

改工具、事件或提示词后必须重跑 `describe:extension`,`describe.json` 不进提示词但市场与 check 读它。

| 文件 | 内容 |
|---|---|
| `src/definition.ts` | `WorldDefinition`:id、label、默认配置段、`create()`、`describe` |
| `src/config.ts` | 配置段类型、默认值、WebUI 配置组(五项 `x-hot`) |
| `src/store.ts` | 落盘存储与到期判断的纯函数 |
| `src/time.ts` | ISO 8601 解析与按时区显示 |
| `src/world.ts` | `World` 实现:五个工具、两个事件、轮询节拍、`webUi()` |
| `src/ENV_PROMPT.md` | 环境提示词模板,`{{reminder.now}}` 等三个占位符由 `envPromptVars()` 报值 |
| `tests/` | store 与 world 两层测试;`helpers/fake-host.ts` 是记录推送的假宿主 |
