/** 包入口:默认导出 `WorldDefinition`,加载器按 `cortico.kind === 'world'` 认它。 */
import { REMINDER } from './definition.ts';

export default REMINDER;
export { REMINDER };
export type { ReminderConfigSection } from './config.ts';
export { ReminderWorld } from './world.ts';
