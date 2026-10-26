/** 提醒的落盘存储:一个 JSON 文件,先写临时文件再改名;读到坏文件时备份并重建。 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type ReminderState = 'pending' | 'done' | 'cancelled';

export interface Reminder {
  id: string;
  /** 提醒内容,原样保存。 */
  text: string;
  /** 到点时间,epoch 毫秒。 */
  at: number;
  createdAt: number;
  state: ReminderState;
  /** 已投递次数。 */
  firedCount: number;
  /** 最近一次投递时间;从未投递时省略。 */
  lastFiredAt?: number;
  /** 归档时间:标记完成或取消的时刻。 */
  closedAt?: number;
  /** 建档时快照的重复间隔(分钟),0 表示不重复。 */
  repeatMinutes: number;
}

export interface ReminderFile {
  version: 1;
  /** 自增序号,用来生成不会重复的 id。 */
  seq: number;
  items: Reminder[];
}

/** 非 pending 记录最多保留多少条。 */
export const HISTORY_LIMIT = 200;

export function reminderDir(dataDir: string): string {
  return join(dataDir, 'reminder');
}

export function storePath(dataDir: string): string {
  return join(reminderDir(dataDir), 'reminders.json');
}

export function emptyStore(): ReminderFile {
  return { version: 1, seq: 0, items: [] };
}

function looksLikeStore(value: unknown): value is ReminderFile {
  if (!value || typeof value !== 'object') return false;
  const v = value as { version?: unknown; seq?: unknown; items?: unknown };
  return v.version === 1 && typeof v.seq === 'number' && Array.isArray(v.items);
}

/** 读存储;文件不存在返回空存储,读坏时把原文件改名备份后返回空存储。 */
export function readStore(dataDir: string): { file: ReminderFile; recovered: boolean } {
  const path = storePath(dataDir);
  if (!existsSync(path)) return { file: emptyStore(), recovered: false };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!looksLikeStore(parsed)) throw new Error('不是提醒存储的结构');
    return { file: parsed, recovered: false };
  } catch {
    try {
      renameSync(path, path + '.bad-' + Date.now().toString(36));
    } catch {
      rmSync(path, { force: true });
    }
    return { file: emptyStore(), recovered: true };
  }
}

export function writeStore(dataDir: string, file: ReminderFile): void {
  const dir = reminderDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const path = storePath(dataDir);
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

function makeId(file: ReminderFile, now: number): string {
  file.seq += 1;
  return 'r' + file.seq.toString(36) + '-' + now.toString(36);
}

export interface NewReminder {
  text: string;
  at: number;
  now: number;
  repeatMinutes: number;
}

/** 追加一条待提醒;调用方负责上限检查。 */
export function addReminder(file: ReminderFile, input: NewReminder): Reminder {
  const item: Reminder = {
    id: makeId(file, input.now),
    text: input.text,
    at: input.at,
    createdAt: input.now,
    state: 'pending',
    firedCount: 0,
    repeatMinutes: input.repeatMinutes,
  };
  file.items.push(item);
  return item;
}

function findPending(file: ReminderFile, id: string): Reminder | undefined {
  return file.items.find((it) => it.id === id && it.state === 'pending');
}

/** 标成完成;找不到待办项返回 false。 */
export function completeReminder(file: ReminderFile, id: string, now: number): boolean {
  const item = findPending(file, id);
  if (!item) return false;
  item.state = 'done';
  item.closedAt = now;
  return true;
}

/** 标成取消;找不到待办项返回 false。 */
export function cancelReminder(file: ReminderFile, id: string, now: number): boolean {
  const item = findPending(file, id);
  if (!item) return false;
  item.state = 'cancelled';
  item.closedAt = now;
  return true;
}

/** 往后推 minutes 分钟并清掉已投递次数;找不到待办项返回 false。 */
export function snoozeReminder(file: ReminderFile, id: string, minutes: number, now: number): boolean {
  const item = findPending(file, id);
  if (!item) return false;
  item.at = Math.max(item.at, now) + minutes * 60000;
  item.firedCount = 0;
  delete item.lastFiredAt;
  return true;
}

/** 丢弃多余的已结束记录,只留最近 limit 条。 */
export function pruneClosed(file: ReminderFile, limit: number = HISTORY_LIMIT): number {
  const closed = file.items.filter((it) => it.state !== 'pending');
  if (closed.length <= limit) return 0;
  const drop = new Set(closed.slice(0, closed.length - limit).map((it) => it.id));
  file.items = file.items.filter((it) => !drop.has(it.id));
  return drop.size;
}

export function pendingItems(file: ReminderFile): Reminder[] {
  return file.items.filter((it) => it.state === 'pending').sort((a, b) => a.at - b.at);
}

export function nextPending(file: ReminderFile): Reminder | undefined {
  return pendingItems(file)[0];
}

export interface DueOptions {
  leadMinutes: number;
  repeatMinutes: number;
  maxRepeats: number;
}

/** 此刻需要投递的待办项:到了预告/到点时间,或者该重复提醒了。 */
export function dueItems(file: ReminderFile, now: number, opts: DueOptions): Reminder[] {
  const lead = Math.max(0, opts.leadMinutes) * 60000;
  const repeat = Math.max(0, opts.repeatMinutes) * 60000;
  return pendingItems(file).filter((it) => {
    if (it.firedCount === 0) return now >= it.at - lead;
    if (repeat <= 0) return false;
    if (it.firedCount > opts.maxRepeats) return false;
    const last = it.lastFiredAt ?? it.at;
    return now >= last + repeat;
  });
}

export function markFired(item: Reminder, now: number): void {
  item.firedCount += 1;
  item.lastFiredAt = now;
}
