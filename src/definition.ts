import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { REMINDER_DEFAULTS, type ReminderConfigSection } from './config.ts';
import { REMINDER_TOOL_DECLS, ReminderWorld } from './world.ts';

export const REMINDER: WorldDefinition<ReminderConfigSection> = {
  id: 'reminder',
  label: '提醒',
  defaults: () => ({ ...REMINDER_DEFAULTS }),
  // `ctx.cfg` 是 `worlds.reminder` 的活引用:热改的键现读即生效。
  create: (ctx) => new ReminderWorld({
    cfg: ctx.cfg,
    timezone: ctx.timezone,
    dataDir: ctx.dataDir,
  }),
  // 自描述:可能出现的全部工具与会推出的全部事件,不进提示词。
  describe: {
    tools: describeTools(REMINDER_TOOL_DECLS, {
      reminder_add: { zh: '记一条提醒,到点由 World 主动唤醒会话。', en: 'Record a reminder that wakes the conversation when due.' },
      reminder_list: { zh: '按时间顺序列出待提醒。', en: 'List open reminders in due order.' },
      reminder_done: { zh: '把一条提醒标成已处理。', en: 'Mark one reminder as handled.' },
      reminder_cancel: { zh: '取消一条提醒。', en: 'Cancel one open reminder.' },
      reminder_snooze: { zh: '把一条提醒往后推若干分钟。', en: 'Push one reminder further out.' },
    }),
    events: [
      { type: 'reminder.ready', description: { zh: 'World 挂载完成,附带待提醒条数。', en: 'The World was mounted, with the number of open reminders.' } },
      { type: 'reminder.due', description: { zh: '一条提醒到点、预告或需要重复提醒。', en: 'A reminder came due, is due soon, or needs repeating.' } },
    ],
  },
};
