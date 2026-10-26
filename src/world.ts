/**
 * 提醒 World:本地落盘的待办提醒,到点由 World 主动推事件唤醒会话。
 * 工具只做增删改查,时间的判断与投递都在这里,回执只描述可确认的事实。
 */
import { fileURLToPath } from 'node:url';
import type { PushOptions, ToolDef, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { nowIso } from 'cortico/core/util.ts';
import { REMINDER_CONFIG_GROUP, type ReminderConfigSection } from './config.ts';
import {
  addReminder, cancelReminder, completeReminder, dueItems, markFired, nextPending, pendingItems,
  pruneClosed, readStore, snoozeReminder, writeStore, type Reminder,
} from './store.ts';
import { formatLocal, humanizeDelta, parseInstant } from './time.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
/** 扫描间隔:提醒精度到分钟即可,15 秒一次足够,开销可忽略。 */
const TICK_MS = 15_000;
/** 提醒正文的长度上限。 */
const MAX_TEXT = 200;
/** 相对时间的上限:七天。 */
const MAX_IN_MINUTES = 7 * 24 * 60;
const MAX_LIST = 20;

export interface ReminderWorldOptions {
  /** `worlds.reminder` 的活引用。 */
  cfg: ReminderConfigSection;
  timezone: string;
  /** 落盘根目录:提醒写在 <dataDir>/reminder/reminders.json。 */
  dataDir: string;
  /** 时钟,测试可注入。 */
  now?: () => number;
}

/** 全部工具的声明;定义里的 describe 与 `tools()` 都取它。 */
export const REMINDER_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'reminder_add',
    description: 'Add a reminder that wakes the conversation when it comes due. Give either in_minutes or at, not both.',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', description: 'What to be reminded of, in the user\'s own words.' },
        in_minutes: { type: 'number', description: 'Minutes from now, 1 to 10080.' },
        at: { type: 'string', description: 'Absolute time in ISO 8601 with a timezone offset, e.g. 2026-10-27T18:30:00+08:00.' },
        repeat_minutes: { type: 'number', description: 'Repeat every N minutes after it comes due until handled; omit to remind once.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'reminder_list',
    description: 'List the open reminders in due order, with their times and remaining time.',
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        include_closed: { type: 'boolean', description: 'Also list the most recent finished or cancelled reminders.' },
      },
    },
  },
  {
    name: 'reminder_done',
    description: 'Mark one reminder as handled, so it stops repeating.',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'string', description: 'Reminder id from reminder_list.' } },
      required: ['id'],
    },
  },
  {
    name: 'reminder_cancel',
    description: 'Cancel one open reminder without marking it as handled.',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'string', description: 'Reminder id from reminder_list.' } },
      required: ['id'],
    },
  },
  {
    name: 'reminder_snooze',
    description: 'Push one open reminder further out by N minutes and clear its fired count.',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: 'Reminder id from reminder_list.' },
        minutes: { type: 'number', description: 'How many minutes to push it out, 1 to 10080.' },
      },
      required: ['id', 'minutes'],
    },
  },
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '…' : text;
}

export class ReminderWorld implements World {
  readonly id = 'reminder';

  private host: WorldHost | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly opts: ReminderWorldOptions) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  /** 只报值;前缀文本一律来自 ENV_PROMPT.md 模板。 */
  envPromptVars(): Record<string, string> {
    const now = this.now();
    const { file } = readStore(this.opts.dataDir);
    const pending = pendingItems(file);
    const next = pending[0];
    return {
      'reminder.now': formatLocal(now, this.opts.timezone),
      'reminder.summary': pending.length === 0 ? '当前没有待提醒' : '当前 ' + pending.length + ' 条待提醒',
      'reminder.next': next
        ? clip(next.text) + '(' + formatLocal(next.at, this.opts.timezone) + ',' + humanizeDelta(next.at - now) + ')'
        : '没有下一条',
    };
  }

  tools(): ToolDef[] {
    return [
      this.addTool(),
      this.listTool(),
      this.doneTool(),
      this.cancelTool(),
      this.snoozeTool(),
    ];
  }

  webUi(): WorldWebUiDecl {
    const { file } = readStore(this.opts.dataDir);
    const pending = pendingItems(file);
    return {
      badges: [
        { label: '待提醒', value: pending.length, tone: pending.length > 0 ? 'on' : 'plain' },
      ],
      lamps: [
        {
          label: '提醒调度',
          state: this.timer ? 'online' : 'offline',
          hint: this.timer ? '每 15 秒扫描一次到期提醒。' : 'World 未激活,不会主动提醒。',
        },
      ],
      config: [REMINDER_CONFIG_GROUP],
      promptDocs: [
        {
          key: 'worlds.reminder.envPrompt',
          title: '提醒 · 环境提示词',
          description: '提醒 World 进 system 前缀的那一段。',
          path: ENV_PROMPT_FILE,
          role: 'envPrompt',
          vars: [
            { name: 'reminder.now', description: '部署时区的当前时间。' },
            { name: 'reminder.summary', description: '待提醒条数。' },
            { name: 'reminder.next', description: '最近一条待提醒的正文、时间与剩余时间。' },
          ],
        },
      ],
    };
  }

  /** 挂载时补投已过期的提醒,再按配置的节奏轮询。 */
  async start(host: WorldHost): Promise<void> {
    this.host = host;
    const { file, recovered } = readStore(this.opts.dataDir);
    if (recovered) host.log.warn('提醒存储读取失败,已备份并重建: ' + this.opts.dataDir + '/reminder');
    const pending = pendingItems(file);
    await host.pushEvent(
      {
        type: 'reminder.ready',
        ts: nowIso(this.opts.timezone),
        source: this.id,
        origin: 'internal',
        senderKey: this.id,
        text: pending.length === 0
          ? '提醒 World 已挂载,当前没有待提醒。'
          : '提醒 World 已挂载,当前有 ' + pending.length + ' 条待提醒,最近一条是「' + clip(pending[0]!.text) + '」(' + formatLocal(pending[0]!.at, this.opts.timezone) + ')。',
      },
      { trigger: 'flush' },
    );
    this.timer = setInterval(() => { void this.tick(); }, TICK_MS);
    this.timer.unref?.();
    await this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.host = undefined;
  }

  /** 扫描到期提醒并逐条投递;每条都是一次独立的唤醒。 */
  private async tick(): Promise<void> {
    const host = this.host;
    if (!host) return;
    const now = this.now();
    const { file } = readStore(this.opts.dataDir);
    const due = dueItems(file, now, {
      leadMinutes: this.opts.cfg.leadMinutes,
      repeatMinutes: this.opts.cfg.repeatMinutes,
      maxRepeats: this.opts.cfg.maxRepeats,
    });
    if (due.length === 0) return;
    for (const item of due) markFired(item, now);
    writeStore(this.opts.dataDir, file);
    const pushOpts: PushOptions = { trigger: this.opts.cfg.trigger };
    for (const item of due) {
      const atText = formatLocal(item.at, this.opts.timezone);
      const early = now < item.at;
      const repeat = item.firedCount > 1;
      const head = early ? '提醒预告' : repeat ? '提醒仍然待办' : '提醒到点';
      const tail = early ? '将在 ' + humanizeDelta(item.at - now) + '到点' : '设定时间 ' + atText;
      await host.pushEvent(
        {
          type: 'reminder.due',
          ts: nowIso(this.opts.timezone),
          source: this.id,
          origin: 'internal',
          senderKey: this.id,
          text: head + ':' + clip(item.text) + '(' + tail + (repeat ? ',第 ' + item.firedCount + ' 次提醒' : '') + ')。处理完用 reminder_done 标记,需要延后用 reminder_snooze。',
          meta: { reminderId: item.id, at: item.at, firedCount: item.firedCount, early },
        },
        pushOpts,
      );
    }
  }

  private mutate<T>(fn: (file: ReturnType<typeof readStore>['file']) => T): T {
    const { file } = readStore(this.opts.dataDir);
    const result = fn(file);
    pruneClosed(file);
    writeStore(this.opts.dataDir, file);
    return result;
  }

  private addTool(): ToolDef {
    return {
      ...REMINDER_TOOL_DECLS[0]!,
      handler: async (args) => {
        const text = typeof args.text === 'string' ? args.text.trim() : '';
        if (!text) return '没有记录:提醒内容不能为空。';
        if (text.length > MAX_TEXT) return '没有记录:提醒内容超过 ' + MAX_TEXT + ' 字,请压缩到一句话。';
        const now = this.now();
        const hasRelative = args.in_minutes !== undefined && args.in_minutes !== null;
        const hasAbsolute = typeof args.at === 'string' && args.at.trim() !== '';
        if (hasRelative === hasAbsolute) {
          return '没有记录:in_minutes 与 at 必须给且只给一个。';
        }
        let at: number;
        if (hasRelative) {
          if (!isFiniteNumber(args.in_minutes) || args.in_minutes < 1 || args.in_minutes > MAX_IN_MINUTES) {
            return '没有记录:in_minutes 需要是 1 到 ' + MAX_IN_MINUTES + ' 之间的分钟数。';
          }
          at = now + Math.round(args.in_minutes) * 60000;
        } else {
          const parsed = parseInstant(args.at);
          if (typeof parsed !== 'number') return '没有记录:' + parsed.error;
          at = parsed;
          if (at <= now) return '没有记录:at 是过去的时间(' + formatLocal(at, this.opts.timezone) + '),提醒必须排在未来。';
        }
        let repeatMinutes = 0;
        if (args.repeat_minutes !== undefined && args.repeat_minutes !== null) {
          if (!isFiniteNumber(args.repeat_minutes) || args.repeat_minutes < 0 || args.repeat_minutes > 1440) {
            return '没有记录:repeat_minutes 需要是 0 到 1440 之间的分钟数。';
          }
          repeatMinutes = Math.round(args.repeat_minutes);
        }
        const pendingCount = pendingItems(readStore(this.opts.dataDir).file).length;
        if (pendingCount >= this.opts.cfg.maxPending) {
          return '没有记录:待提醒已达上限 ' + this.opts.cfg.maxPending + ' 条,先处理或取消几条再添加。';
        }
        const item = this.mutate((file) => addReminder(file, { text, at, now, repeatMinutes }));
        const repeatNote = repeatMinutes > 0 ? ',到点后每 ' + repeatMinutes + ' 分钟再提醒一次' : '';
        return '已记录 ' + item.id + ',内容「' + clip(text) + '」,到 ' + formatLocal(item.at, this.opts.timezone)
          + '(' + humanizeDelta(item.at - now) + ')' + repeatNote + ',当前共 ' + (pendingCount + 1) + ' 条待提醒。';
      },
    };
  }

  private listTool(): ToolDef {
    return {
      ...REMINDER_TOOL_DECLS[1]!,
      handler: async (args) => {
        const now = this.now();
        const { file } = readStore(this.opts.dataDir);
        const pending = pendingItems(file);
        const lines: string[] = [];
        if (pending.length === 0) {
          lines.push('当前没有待提醒。');
        } else {
          lines.push('待提醒 ' + pending.length + ' 条:');
          for (const item of pending.slice(0, MAX_LIST)) {
            const extra = item.firedCount > 0 ? ',已提醒 ' + item.firedCount + ' 次' : '';
            const repeat = item.repeatMinutes > 0 ? ',每 ' + item.repeatMinutes + ' 分钟重复' : '';
            lines.push('- ' + item.id + ' ' + clip(item.text) + ' @ ' + formatLocal(item.at, this.opts.timezone)
              + '(' + humanizeDelta(item.at - now) + extra + repeat + ')');
          }
          if (pending.length > MAX_LIST) lines.push('…还有 ' + (pending.length - MAX_LIST) + ' 条未列出。');
        }
        if (args.include_closed === true) {
          const closed = file.items.filter((it) => it.state !== 'pending').slice(-5);
          if (closed.length > 0) {
            lines.push('最近结束:');
            for (const item of closed) {
              const when = item.closedAt ? formatLocal(item.closedAt, this.opts.timezone) : '未知时间';
              lines.push('- ' + item.id + ' ' + clip(item.text) + ' ' + (item.state === 'done' ? '已完成' : '已取消') + ' @ ' + when);
            }
          }
        }
        return lines.join('\n');
      },
    };
  }

  private doneTool(): ToolDef {
    return {
      ...REMINDER_TOOL_DECLS[2]!,
      handler: async (args) => {
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) return '没有变更:需要 id。';
        const now = this.now();
        const ok = this.mutate((file) => completeReminder(file, id, now));
        return ok ? '已标记完成 ' + id + ',不再重复提醒。' : '没有找到待提醒 ' + id + ',用 reminder_list 确认 id。';
      },
    };
  }

  private cancelTool(): ToolDef {
    return {
      ...REMINDER_TOOL_DECLS[3]!,
      handler: async (args) => {
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) return '没有变更:需要 id。';
        const now = this.now();
        const ok = this.mutate((file) => cancelReminder(file, id, now));
        return ok ? '已取消 ' + id + '。' : '没有找到待提醒 ' + id + ',用 reminder_list 确认 id。';
      },
    };
  }

  private snoozeTool(): ToolDef {
    return {
      ...REMINDER_TOOL_DECLS[4]!,
      handler: async (args) => {
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) return '没有变更:需要 id。';
        if (!isFiniteNumber(args.minutes) || args.minutes < 1 || args.minutes > MAX_IN_MINUTES) {
          return '没有变更:minutes 需要是 1 到 ' + MAX_IN_MINUTES + ' 之间的分钟数。';
        }
        const now = this.now();
        const minutes = Math.round(args.minutes);
        const item = this.mutate((file) => {
          const ok = snoozeReminder(file, id, minutes, now);
          return ok ? pendingItems(file).find((it) => it.id === id) : undefined;
        });
        if (!item) return '没有找到待提醒 ' + id + ',用 reminder_list 确认 id。';
        return '已把 ' + id + ' 延后 ' + minutes + ' 分钟,新时间 ' + formatLocal(item.at, this.opts.timezone)
          + '(' + humanizeDelta(item.at - now) + ')。';
      },
    };
  }
}
