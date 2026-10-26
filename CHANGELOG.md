## 0.1.0

- 首个版本:本地提醒落盘,到点由 World 推 `reminder.due` 唤醒会话。
- 五个工具 `reminder_add` / `reminder_list` / `reminder_done` / `reminder_cancel` / `reminder_snooze`。
- 两个事件 `reminder.ready` 与 `reminder.due`,origin 均为 `internal`。
- 五项热改配置:投递方式、待办上限、提前预告、重复间隔、重复次数。
- 测试 24 项(store 11 + world 13)。
