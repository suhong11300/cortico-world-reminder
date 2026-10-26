import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCallContext, ToolDef } from 'cortico/core/types.ts';
import { dryMountWorld } from 'cortico/extensions/dry-mount.ts';
import { REMINDER } from '../src/definition.ts';
import { REMINDER_DEFAULTS, type ReminderConfigSection } from '../src/config.ts';
import { ReminderWorld } from '../src/world.ts';
import { storePath } from '../src/store.ts';
import { FakeHost } from './helpers/fake-host.ts';

const T0 = 1_700_000_000_000;
const MIN = 60_000;
const CALL = {} as ToolCallContext;

let dataDir: string;
let clock: number;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'reminder-world-'));
  clock = T0;
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function makeWorld(over: Partial<ReminderConfigSection> = {}): ReminderWorld {
  const cfg: ReminderConfigSection = { ...REMINDER_DEFAULTS, enabled: true, ...over };
  return new ReminderWorld({ cfg, timezone: 'Asia/Shanghai', dataDir, now: () => clock });
}

function tool(world: ReminderWorld, name: string): ToolDef {
  const found = world.tools().find((t) => t.name === name);
  if (!found) throw new Error('缺少工具 ' + name);
  return found;
}

/** tick 是内部节拍:这里直接驱动一次,验证到点投递。 */
function tick(world: ReminderWorld): Promise<void> {
  return (world as unknown as { tick(): Promise<void> }).tick();
}

describe('提醒 World', () => {
  it('干装载不报失败:装载器会接受它', async () => {
    const report = await dryMountWorld(REMINDER, { scratchDir: dataDir });
    expect(report.failures).toEqual([]);
  });

  it('挂载时报一次 reminder.ready,origin 是 internal', async () => {
    const world = makeWorld();
    const host = new FakeHost();
    await world.start(host);
    expect(host.events.map((e) => e.type)).toEqual(['reminder.ready']);
    expect(host.events[0]!.origin).toBe('internal');
    expect(host.events[0]!.text).toContain('没有待提醒');
    await world.stop();
  });

  it('已有待提醒时,挂载事件里报出条数与最近一条', async () => {
    const world = makeWorld();
    await tool(world, 'reminder_add').handler({ text: '交电费', in_minutes: 30 }, CALL);
    const host = new FakeHost();
    await world.start(host);
    expect(host.events[0]!.text).toContain('1 条待提醒');
    expect(host.events[0]!.text).toContain('交电费');
    await world.stop();
  });

  it('reminder_add 落盘,reminder_list 读得到,id 可复用于完成', async () => {
    const world = makeWorld();
    const added = String(await tool(world, 'reminder_add').handler({ text: '喝水', in_minutes: 10 }, CALL));
    expect(added).toContain('已记录');
    expect(existsSync(storePath(dataDir))).toBe(true);
    const list = String(await tool(world, 'reminder_list').handler({}, CALL));
    expect(list).toContain('喝水');
    const id = /已记录 (r[^,\s]+),/.exec(added)![1]!;
    expect(String(await tool(world, 'reminder_done').handler({ id }, CALL))).toContain('已标记完成');
    const after = String(await tool(world, 'reminder_list').handler({ include_closed: true }, CALL));
    expect(after).toContain('当前没有待提醒');
    expect(after).toContain('已完成');
  });

  it('到点后推 reminder.due,一条提醒一次', async () => {
    const world = makeWorld();
    const host = new FakeHost();
    await world.start(host);
    await tool(world, 'reminder_add').handler({ text: '开会', in_minutes: 5 }, CALL);
    clock = T0 + 4 * MIN;
    await tick(world);
    expect(host.events).toHaveLength(1);
    clock = T0 + 5 * MIN;
    await tick(world);
    const dues = host.events.filter((e) => e.type === 'reminder.due');
    expect(dues).toHaveLength(1);
    expect(dues[0]!.text).toContain('开会');
    expect(dues[0]!.text).toContain('提醒到点');
    await tick(world);
    expect(host.events.filter((e) => e.type === 'reminder.due')).toHaveLength(1);
    await world.stop();
  });

  it('提前预告:还没到点就推,文案是预告而不是到点', async () => {
    const world = makeWorld({ leadMinutes: 10 });
    const host = new FakeHost();
    await world.start(host);
    await tool(world, 'reminder_add').handler({ text: '出门', in_minutes: 30 }, CALL);
    clock = T0 + 20 * MIN;
    await tick(world);
    const dues = host.events.filter((e) => e.type === 'reminder.due');
    expect(dues).toHaveLength(1);
    expect(dues[0]!.text).toContain('提醒预告');
    expect(dues[0]!.text).toContain('10 分钟后到点');
    await world.stop();
  });

  it('重复提醒按配置再来一次,处理完就停', async () => {
    const world = makeWorld({ repeatMinutes: 5, maxRepeats: 1 });
    const host = new FakeHost();
    await world.start(host);
    const added = String(await tool(world, 'reminder_add').handler({ text: '回邮件', in_minutes: 1, repeat_minutes: 5 }, CALL));
    const id = /已记录 (r[^,\s]+),/.exec(added)![1]!;
    clock = T0 + MIN;
    await tick(world);
    clock = T0 + 6 * MIN;
    await tick(world);
    expect(host.events.filter((e) => e.type === 'reminder.due')).toHaveLength(2);
    await tool(world, 'reminder_done').handler({ id }, CALL);
    clock = T0 + 30 * MIN;
    await tick(world);
    expect(host.events.filter((e) => e.type === 'reminder.due')).toHaveLength(2);
    await world.stop();
  });

  it('待提醒到达上限后拒绝新条目', async () => {
    const world = makeWorld({ maxPending: 1 });
    expect(String(await tool(world, 'reminder_add').handler({ text: 'a', in_minutes: 5 }, CALL))).toContain('已记录');
    const second = String(await tool(world, 'reminder_add').handler({ text: 'b', in_minutes: 5 }, CALL));
    expect(second).toContain('上限');
  });

  it('参数不对时如实说明原因,不写盘', async () => {
    const world = makeWorld();
    const add = tool(world, 'reminder_add');
    expect(String(await add.handler({ text: '  ', in_minutes: 5 }, CALL))).toContain('不能为空');
    expect(String(await add.handler({ text: 'a' }, CALL))).toContain('只给一个');
    expect(String(await add.handler({ text: 'a', in_minutes: 5, at: '2026-10-27T18:30:00+08:00' }, CALL))).toContain('只给一个');
    expect(String(await add.handler({ text: 'a', in_minutes: 0 }, CALL))).toContain('1 到');
    expect(String(await add.handler({ text: 'a', at: '2026-10-27 18:30' }, CALL))).toContain('带时区');
    expect(String(await add.handler({ text: 'a', at: '2020-01-01T00:00:00+08:00' }, CALL))).toContain('过去的时间');
    expect(existsSync(storePath(dataDir))).toBe(false);
  });

  it('延后会把时间推后,列表里能看到新时间', async () => {
    const world = makeWorld();
    const added = String(await tool(world, 'reminder_add').handler({ text: 'a', in_minutes: 10 }, CALL));
    const id = /已记录 (r[^,\s]+),/.exec(added)![1]!;
    const snoozed = String(await tool(world, 'reminder_snooze').handler({ id, minutes: 20 }, CALL));
    expect(snoozed).toContain('延后 20 分钟');
    const list = String(await tool(world, 'reminder_list').handler({}, CALL));
    expect(list).toContain('30 分钟后');
  });

  it('环境提示词变量报出时间、条数与下一条', async () => {
    const world = makeWorld();
    await tool(world, 'reminder_add').handler({ text: '散步', in_minutes: 15 }, CALL);
    const vars = world.envPromptVars();
    expect(vars['reminder.now']).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(vars['reminder.summary']).toBe('当前 1 条待提醒');
    expect(vars['reminder.next']).toContain('散步');
    expect(vars['reminder.next']).toContain('15 分钟后');
  });

  it('webUi 声明配置段、提示词文档与状态灯', () => {
    const decl = makeWorld().webUi();
    expect(decl.config?.[0]!.id).toBe('world:reminder');
    expect(decl.promptDocs?.[0]!.role).toBe('envPrompt');
    expect(decl.lamps?.[0]!.state).toBe('offline');
    expect(decl.badges?.[0]!.value).toBe(0);
  });

  it('五个工具都在,名字都带 reminder_ 前缀', () => {
    const names = makeWorld().tools().map((t) => t.name).sort();
    expect(names).toEqual([
      'reminder_add', 'reminder_cancel', 'reminder_done', 'reminder_list', 'reminder_snooze',
    ]);
  });
});

describe('提醒 World 的挂载容错', () => {
  /** 前几次 pushEvent 抛错,模拟宿主 core 还没就绪。 */
  class FlakyHost extends FakeHost {
    private left: number;
    constructor(fails: number) {
      super();
      this.left = fails;
    }
    override async pushEvent(e: Parameters<FakeHost['pushEvent']>[0], opts?: Parameters<FakeHost['pushEvent']>[1]) {
      if (this.left > 0) {
        this.left -= 1;
        throw new Error('core not ready');
      }
      return super.pushEvent(e, opts);
    }
  }

  it('就绪事件抛错也不打断 start,到点的提醒照样投出去', async () => {
    const world = makeWorld();
    await tool(world, 'reminder_add').handler({ text: '喝水', in_minutes: 1 }, CALL);
    clock += 2 * MIN;
    const host = new FlakyHost(1);
    await expect(world.start(host)).resolves.toBeUndefined();
    expect(host.events.some((e) => e.type === 'reminder.due')).toBe(true);
    await world.stop();
  });

  it('三轮推送全挂时 start 仍然返回,不会把定时器饿死', async () => {
    const world = makeWorld();
    const host = new FlakyHost(99);
    await expect(world.start(host)).resolves.toBeUndefined();
    expect(host.events).toEqual([]);
    await world.stop();
  });
});
