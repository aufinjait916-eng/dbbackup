import { BackupScheduleConfig } from '../types';

export const DAY_OF_WEEK_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function parseTimeOfDay(timeOfDay: string): { hour: number; minute: number } {
  const [hStr, mStr] = (timeOfDay || '02:00').split(':');
  const hour = Math.min(23, Math.max(0, parseInt(hStr || '2', 10) || 0));
  const minute = Math.min(59, Math.max(0, parseInt(mStr || '0', 10) || 0));
  return { hour, minute };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function getScheduledSlotKey(schedule: BackupScheduleConfig, slotDate: Date): string {
  const datePart = formatDateKey(slotDate);
  const hh = pad2(slotDate.getHours());
  const mm = pad2(slotDate.getMinutes());
  return `${schedule.frequency}:${datePart}:${hh}:${mm}`;
}

export function computeNextScheduledRun(
  schedule: BackupScheduleConfig,
  now: Date = new Date()
): Date | null {
  if (!schedule.enabled) return null;

  const { hour, minute } = parseTimeOfDay(schedule.timeOfDay);

  if (schedule.frequency === 'hourly') {
    const candidate = new Date(now);
    candidate.setSeconds(0, 0);
    candidate.setMinutes(minute);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setHours(candidate.getHours() + 1);
    }
    return candidate;
  }

  if (schedule.frequency === 'daily') {
    const candidate = new Date(now);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate;
  }

  if (schedule.frequency === 'weekly') {
    const targetDay = schedule.dayOfWeek;
    const candidate = new Date(now);
    candidate.setHours(hour, minute, 0, 0);
    let daysUntil = (targetDay - candidate.getDay() + 7) % 7;
    if (daysUntil === 0 && candidate.getTime() <= now.getTime()) {
      daysUntil = 7;
    }
    candidate.setDate(candidate.getDate() + daysUntil);
    return candidate;
  }

  // monthly (days 1-28)
  const targetDom = Math.min(28, Math.max(1, schedule.dayOfMonth || 1));
  const candidate = new Date(now.getFullYear(), now.getMonth(), targetDom, hour, minute, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setMonth(candidate.getMonth() + 1);
  }
  return candidate;
}

/**
 * Checks whether the current local clock matches a scheduled occurrence
 * within a 2-minute execution window (to survive browser background timer throttling)
 * and has not already executed for that slotKey.
 */
export function isScheduleDueNow(
  schedule: BackupScheduleConfig,
  now: Date = new Date()
): { due: boolean; slotKey: string } {
  if (!schedule.enabled) {
    return { due: false, slotKey: '' };
  }

  const { hour, minute } = parseTimeOfDay(schedule.timeOfDay);
  const slotDate = new Date(now);
  slotDate.setSeconds(0, 0);

  if (schedule.frequency === 'hourly') {
    slotDate.setMinutes(minute);
  } else if (schedule.frequency === 'daily') {
    slotDate.setHours(hour, minute, 0, 0);
  } else if (schedule.frequency === 'weekly') {
    if (now.getDay() !== schedule.dayOfWeek) {
      return { due: false, slotKey: '' };
    }
    slotDate.setHours(hour, minute, 0, 0);
  } else {
    const targetDom = Math.min(28, Math.max(1, schedule.dayOfMonth || 1));
    if (now.getDate() !== targetDom) {
      return { due: false, slotKey: '' };
    }
    slotDate.setHours(hour, minute, 0, 0);
  }

  const diffMs = now.getTime() - slotDate.getTime();
  // Due if current clock is at or within 120 seconds past the exact scheduled minute
  if (diffMs < 0 || diffMs > 120 * 1000) {
    return { due: false, slotKey: '' };
  }

  const slotKey = getScheduledSlotKey(schedule, slotDate);
  if (schedule.lastRunKey === slotKey) {
    return { due: false, slotKey };
  }

  return { due: true, slotKey };
}

export function formatCountdown(target: Date, now: Date = new Date()): string {
  const diffSec = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000));
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${pad2(mins)}m`;
  }
  if (hours > 0) {
    return `${hours}h ${pad2(mins)}m ${pad2(secs)}s`;
  }
  return `${mins}m ${pad2(secs)}s`;
}

export function describeSchedule(schedule: BackupScheduleConfig): string {
  const { minute } = parseTimeOfDay(schedule.timeOfDay);
  switch (schedule.frequency) {
    case 'hourly':
      return `Hourly at :${pad2(minute)}`;
    case 'daily':
      return `Daily at ${schedule.timeOfDay}`;
    case 'weekly':
      return `Every ${DAY_OF_WEEK_LABELS[schedule.dayOfWeek] || 'Sunday'} at ${schedule.timeOfDay}`;
    case 'monthly':
      return `Monthly on Day ${schedule.dayOfMonth} at ${schedule.timeOfDay}`;
    default:
      return `Daily at ${schedule.timeOfDay}`;
  }
}
