## 0.1.2

发布元数据对齐：

- 补 `LICENSE` 正文并把它加进 `files`，声明 MIT 的同时把许可证随包带上。
- 补 `author` 字段并统一成「苏鸿与维基 (suhong11300)」，市场卡片与 npm 页面显示作者名，不再回退到 npm 账号名。
- 补 `repository` / `homepage` / `bugs`，指向 github.com/suhong11300/cortico-world-reminder。

代码与上一版完全一致，不涉及行为变化。
## 0.1.3

### 文档

- README 换成统一首屏：npm / 许可证 / node / world api 四个徽章、一句话定位、要点清单、元信息行与目录；二级标题去掉标点，锚点与目录逐条对齐。
- 标签口径与实际 `cortico.tags` 对齐；补 `keywords` 便于在 npm 与 GitHub 搜索到。

## 0.1.1

简介改为正式说明体：先一句定位，再用分号分列能力与边界，去掉口语化措辞与第二人称。
顶层 `description` 与 `cortico.locales.zh` 取同一句，市场卡片与 npm 页面展示一致；`en` 同步改写。
代码与 0.1.0 完全一致，不涉及行为变化。

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
