import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addReminder, cancelReminder, completeReminder, dueItems, emptyStore, markFired, nextPending,
  pendingItems, pruneClosed, readStore, reminderDir, snoozeReminder, storePath, writeStore,
} from '../src/store.ts';

let dataDir: string;
const T0 = 1_700_000_000_000;
const MIN = 60_000;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'reminder-store-'));
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('提醒存储', () => {
  it('没有文件时读到空存储,不报错', () => {
    const { file, recovered } = readStore(dataDir);
    expect(recovered).toBe(false);
    expect(file.items).toEqual([]);
    expect(file.version).toBe(1);
  });

  it('写出去的内容能原样读回', () => {
    const file = emptyStore();
    const item = addReminder(file, { text: '喝水', at: T0 + 10 * MIN, now: T0, repeatMinutes: 0 });
    writeStore(dataDir, file);
    expect(existsSync(storePath(dataDir))).toBe(true);
    const back = readStore(dataDir).file;
    expect(back.items).toHaveLength(1);
    expect(back.items[0]!.id).toBe(item.id);
    expect(back.items[0]!.text).toBe('喝水');
    expect(back.items[0]!.state).toBe('pending');
  });

  it('id 单调且不重复', () => {
    const file = emptyStore();
    const ids = new Set<string>();
    for (let i = 0; i < 20; i += 1) ids.add(addReminder(file, { text: 't' + i, at: T0, now: T0, repeatMinutes: 0 }).id);
    expect(ids.size).toBe(20);
  });

  it('读到坏文件:备份成 .bad-* 并返回空存储', () => {
    mkdirSync(reminderDir(dataDir), { recursive: true });
    writeFileSync(storePath(dataDir), '{ 这不是 JSON', 'utf8');
    const { file, recovered } = readStore(dataDir);
    expect(recovered).toBe(true);
    expect(file.items).toEqual([]);
    const names = readdirSync(reminderDir(dataDir));
    expect(names.some((n) => n.includes('.bad-'))).toBe(true);
  });

  it('结构不对(version 不是 1)也按坏文件处理', () => {
    mkdirSync(reminderDir(dataDir), { recursive: true });
    writeFileSync(storePath(dataDir), JSON.stringify({ version: 2, items: [] }), 'utf8');
    expect(readStore(dataDir).recovered).toBe(true);
  });

  it('完成、取消只对 pending 生效', () => {
    const file = emptyStore();
    const a = addReminder(file, { text: 'a', at: T0 + MIN, now: T0, repeatMinutes: 0 });
    const b = addReminder(file, { text: 'b', at: T0 + MIN, now: T0, repeatMinutes: 0 });
    expect(completeReminder(file, a.id, T0)).toBe(true);
    expect(completeReminder(file, a.id, T0)).toBe(false);
    expect(cancelReminder(file, b.id, T0)).toBe(true);
    expect(cancelReminder(file, b.id, T0)).toBe(false);
    expect(pendingItems(file)).toEqual([]);
  });

  it('延后会往后推时间并清掉已提醒次数', () => {
    const file = emptyStore();
    const item = addReminder(file, { text: 'a', at: T0 + MIN, now: T0, repeatMinutes: 5 });
    markFired(item, T0 + MIN);
    expect(item.firedCount).toBe(1);
    expect(snoozeReminder(file, item.id, 10, T0 + 2 * MIN)).toBe(true);
    expect(item.firedCount).toBe(0);
    expect(item.lastFiredAt).toBeUndefined();
    expect(item.at).toBe(T0 + 12 * MIN);
  });

  it('列表按到点时间排序,nextPending 取最近的一条', () => {
    const file = emptyStore();
    addReminder(file, { text: 'late', at: T0 + 30 * MIN, now: T0, repeatMinutes: 0 });
    addReminder(file, { text: 'soon', at: T0 + 5 * MIN, now: T0, repeatMinutes: 0 });
    expect(pendingItems(file).map((it) => it.text)).toEqual(['soon', 'late']);
    expect(nextPending(file)!.text).toBe('soon');
  });

  it('到期判断:含提前预告,且不重复时只触发一次', () => {
    const file = emptyStore();
    const item = addReminder(file, { text: 'a', at: T0 + 10 * MIN, now: T0, repeatMinutes: 0 });
    const opts = { leadMinutes: 0, repeatMinutes: 0, maxRepeats: 3 };
    expect(dueItems(file, T0 + 9 * MIN, opts)).toEqual([]);
    expect(dueItems(file, T0 + 10 * MIN, opts).map((it) => it.id)).toEqual([item.id]);
    markFired(item, T0 + 10 * MIN);
    expect(dueItems(file, T0 + 60 * MIN, opts)).toEqual([]);
    // 提前预告只对还没投递过的条目生效
    const fresh = addReminder(file, { text: 'b', at: T0 + 20 * MIN, now: T0, repeatMinutes: 0 });
    const lead = { leadMinutes: 5, repeatMinutes: 0, maxRepeats: 3 };
    expect(dueItems(file, T0 + 14 * MIN, lead).map((it) => it.id)).toEqual([]);
    expect(dueItems(file, T0 + 15 * MIN, lead).map((it) => it.id)).toEqual([fresh.id]);
  });

  it('重复提醒按间隔触发,并受 maxRepeats 封顶', () => {
    const file = emptyStore();
    const item = addReminder(file, { text: 'a', at: T0, now: T0, repeatMinutes: 5 });
    const opts = { leadMinutes: 0, repeatMinutes: 5, maxRepeats: 2 };
    expect(dueItems(file, T0, opts)).toHaveLength(1);
    markFired(item, T0);
    expect(dueItems(file, T0 + 4 * MIN, opts)).toEqual([]);
    expect(dueItems(file, T0 + 5 * MIN, opts)).toHaveLength(1);
    markFired(item, T0 + 5 * MIN);
    expect(dueItems(file, T0 + 10 * MIN, opts)).toHaveLength(1);
    markFired(item, T0 + 10 * MIN);
    expect(dueItems(file, T0 + 20 * MIN, opts)).toEqual([]);
  });

  it('已结束记录超过上限时只留最近的部分', () => {
    const file = emptyStore();
    for (let i = 0; i < 30; i += 1) {
      const it = addReminder(file, { text: 'x' + i, at: T0, now: T0, repeatMinutes: 0 });
      completeReminder(file, it.id, T0);
    }
    expect(pruneClosed(file, 10)).toBe(20);
    expect(file.items).toHaveLength(10);
    expect(file.items.every((it) => it.state === 'done')).toBe(true);
  });
});
