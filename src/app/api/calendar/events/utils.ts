export function normalizeCalendarColor(value: string | undefined): string {
  return value && ["blue", "violet", "emerald", "orange", "rose"].includes(value)
    ? value
    : "blue";
}
