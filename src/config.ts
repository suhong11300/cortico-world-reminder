import type { ConfigGroup } from 'cortico/core/types.ts';

/** 到点提醒的投递方式;含义见 PushOptions.trigger。 */
export type ReminderTrigger = 'flush' | 'preempt' | 'interrupt';

/** config.json 的 worlds.reminder 段,默认禁用;bot 或部署可启用。 */
export interface ReminderConfigSection {
  enabled: boolean;
  /** 到点提醒的投递方式:flush 等当前一轮结束,preempt 与 interrupt 更急。热改。 */
  trigger: ReminderTrigger;
  /** 未完成提醒的上限;满了再添加会被拒绝。热改。 */
  maxPending: number;
  /** 提前多少分钟预告;0 表示只在到点时提醒。热改。 */
  leadMinutes: number;
  /** 到点后若一直没人处理,隔多少分钟再提醒一次;0 表示只提醒一次。热改。 */
  repeatMinutes: number;
  /** 同一条提醒最多重复几次,避免一直占用会话。热改。 */
  maxRepeats: number;
}

export const REMINDER_DEFAULTS: ReminderConfigSection = {
  enabled: false,
  trigger: 'flush',
  maxPending: 20,
  leadMinutes: 0,
  repeatMinutes: 0,
  maxRepeats: 3,
};

/** World 配置的 JSON Schema 声明。 */
export const REMINDER_CONFIG_GROUP: ConfigGroup = {
  id: 'world:reminder',
  owner: 'world:reminder',
  schema: {
    type: 'object',
    title: '提醒',
    properties: {
      'worlds.reminder.trigger': {
        type: 'string',
        title: '到点投递方式',
        description: 'flush 等当前一轮结束;preempt 取消尚未产出的模型轮;interrupt 直接停当前轮。',
        enum: ['flush', 'preempt', 'interrupt'],
        'x-hot': true,
      },
      'worlds.reminder.maxPending': {
        type: 'number',
        title: '未完成提醒上限',
        description: '同时存在的未完成提醒条数上限,满了再添加会被拒绝。',
        minimum: 1,
        maximum: 200,
        'x-hot': true,
      },
      'worlds.reminder.leadMinutes': {
        type: 'number',
        title: '提前预告(分钟)',
        description: '提前多少分钟提醒一次;0 表示只在到点提醒。',
        minimum: 0,
        maximum: 1440,
        'x-hot': true,
      },
      'worlds.reminder.repeatMinutes': {
        type: 'number',
        title: '重复间隔(分钟)',
        description: '到点后一直没人处理时,隔多少分钟再提一次;0 表示只提一次。',
        minimum: 0,
        maximum: 1440,
        'x-hot': true,
      },
      'worlds.reminder.maxRepeats': {
        type: 'number',
        title: '最多重复次数',
        description: '同一条提醒重复提醒的上限。',
        minimum: 0,
        maximum: 20,
        'x-hot': true,
      },
    },
  },
};
