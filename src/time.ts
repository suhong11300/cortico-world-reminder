/** 时间解析与显示:只接受带时区的绝对时间,显示一律用部署时区。 */

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

/** 解析 ISO 8601 时间戳;不带时区偏移时返回错误,避免按进程本地时区猜。 */
export function parseInstant(raw: unknown): number | { error: string } {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { error: 'at 不能为空,需要带时区的 ISO 8601 时间,例如 2026-10-27T18:30:00+08:00。' };
  if (!ISO_WITH_ZONE.test(text)) {
    return { error: 'at 必须是带时区偏移的 ISO 8601 时间,例如 2026-10-27T18:30:00+08:00 或 2026-10-27T10:30:00Z。' };
  }
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return { error: 'at 不是合法时间: ' + text };
  return ms;
}

/** 用部署时区把毫秒时间点显示成 YYYY-MM-DD HH:mm。 */
export function formatLocal(ms: number, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return fmt.format(new Date(ms)).replace('T', ' ');
}

/** 人类可读的剩余时间;已到点给「已到点」。 */
export function humanizeDelta(ms: number): string {
  if (ms <= 0) return '已到点';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return '不到 1 分钟后';
  if (minutes < 60) return minutes + ' 分钟后';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? hours + ' 小时后' : hours + ' 小时 ' + rest + ' 分钟后';
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? days + ' 天后' : days + ' 天 ' + restHours + ' 小时后';
}
