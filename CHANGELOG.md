## 0.1.0

- 首个版本:本地提醒落盘,到点由 World 推 `reminder.due` 唤醒会话。
- 五个工具 `reminder_add` / `reminder_list` / `reminder_done` / `reminder_cancel` / `reminder_snooze`。
- 两个事件 `reminder.ready` 与 `reminder.due`,origin 均为 `internal`。
- 五项热改配置:投递方式、待办上限、提前预告、重复间隔、重复次数。
- **挂载顺序加固**:先建 15 秒轮询,再投就绪事件。宿主 core 还没就绪时 `pushEvent` 会抛,
  按老写法一抛 `start()` 就中断、定时器根本没建,World 看着「已启动」却永远不会提醒;
  现在抛错只补投一次(2 秒后重试),轮询照旧。
- 市场卡片:新增 `icon.svg`(深底铃铛 + 两侧响铃弧 + 金色铃锤),写进 `cortico.icon` 与 `files`,
  并补 `cortico.locales.zh/en`(提醒 / Reminder)。
- 标签:`companion`(sense of time / daily routine)。
- 测试 26 项(store 11 + world 15),含两条挂载容错:就绪事件抛错仍能投出到点的提醒、
  连续抛错也不会让 `start()` 挂住。
