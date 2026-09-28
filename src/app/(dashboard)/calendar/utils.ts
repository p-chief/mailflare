import type { CalendarEvent, EventGroup, EventResizeEdge } from "./types";

export const CALENDAR_START_HOUR = 0;
export const CALENDAR_END_HOUR = 24;
export const CALENDAR_HOUR_HEIGHT = 36;

export const EVENT_COLORS = {
  blue: "border-blue-500 bg-blue-100 text-blue-900",
  violet: "border-violet-500 bg-violet-100 text-violet-900",
  emerald: "border-emerald-500 bg-emerald-100 text-emerald-900",
  orange: "border-orange-500 bg-orange-100 text-orange-900",
  rose: "border-rose-500 bg-rose-100 text-rose-900",
} as const;

export const EVENT_COLOR_DOTS = {
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  emerald: "bg-emerald-500",
  orange: "bg-orange-500",
  rose: "bg-rose-500",
} as const;

export function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function addDays(value: Date, days: number): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + days);
}

export function monthGridDates(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

export function startOfWorkweek(value: Date): Date {
  const day = value.getDay();
  return addDays(startOfDay(value), day === 0 ? -6 : 1 - day);
}

export function dateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function formatLocalDateTime(value: Date): string {
  return `${dateKey(value)}T${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

export function formatHour(hour: number): string {
  return new Date(2026, 0, 1, hour).toLocaleTimeString(undefined, { hour: "numeric" });
}

export function formatEventTime(value: Date): string {
  return value.toLocaleTimeString(undefined, { hour: "numeric", minute: value.getMinutes() ? "2-digit" : undefined });
}

export function formatEventRange(event: CalendarEvent): string {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  return `${formatEventTime(start)} – ${formatEventTime(end)}`;
}

export function groupUpcomingEvents(events: CalendarEvent[], today: Date): EventGroup[] {
  const todayStart = startOfDay(today);
  const tomorrowStart = addDays(todayStart, 1);
  const groups: EventGroup[] = [];

  for (const event of events) {
    const eventDate = startOfDay(new Date(event.startsAt));
    if (eventDate < todayStart) continue;
    const key = dateKey(eventDate);
    const label = key === dateKey(todayStart)
      ? "Today"
      : key === dateKey(tomorrowStart)
        ? "Tomorrow"
        : eventDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    const lastGroup = groups[groups.length - 1];
    if (lastGroup?.key === key) lastGroup.events.push(event);
    else groups.push({ key, label, events: [event] });
  }

  return groups;
}

export function eventPosition(event: CalendarEvent, day: Date): { top: number; height: number } | null {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const dayStart = startOfDay(day).getTime();
  const startMinutes = Math.max(CALENDAR_START_HOUR * 60, (start.getTime() - dayStart) / 60_000);
  const endMinutes = Math.min(CALENDAR_END_HOUR * 60, (end.getTime() - dayStart) / 60_000);
  if (endMinutes <= startMinutes) return null;
  return {
    top: (startMinutes - CALENDAR_START_HOUR * 60) * CALENDAR_HOUR_HEIGHT / 60,
    height: (endMinutes - startMinutes) * CALENDAR_HOUR_HEIGHT / 60,
  };
}

export function dropStartForPosition(day: Date, pixelsFromTop: number): Date {
  const minutes = Math.max(0, Math.min(24 * 60 - 15, Math.round(pixelsFromTop * 60 / CALENDAR_HOUR_HEIGHT / 15) * 15));
  const start = startOfDay(day);
  start.setMinutes(minutes);
  return start;
}

export function resizeEventTimes(event: CalendarEvent, day: Date, edge: EventResizeEdge, pixelsFromTop: number): { startsAt: Date; endsAt: Date } {
  const minimum = edge === "start" ? 0 : 15;
  const maximum = edge === "start" ? 24 * 60 - 15 : 24 * 60;
  const minutes = Math.max(minimum, Math.min(maximum, Math.round(pixelsFromTop * 60 / CALENDAR_HOUR_HEIGHT / 15) * 15));
  const boundary = startOfDay(day);
  boundary.setMinutes(minutes);
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  if (edge === "start") {
    return { startsAt: new Date(Math.min(boundary.getTime(), endsAt.getTime() - 15 * 60_000)), endsAt };
  }
  return { startsAt, endsAt: new Date(Math.max(boundary.getTime(), startsAt.getTime() + 15 * 60_000)) };
}
