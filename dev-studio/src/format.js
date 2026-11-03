/** Formatting helpers and the status vocabulary (AGENT-OWNED). */

export const STATUS_LABEL = { todo: "To do", doing: "Doing", done: "Done" };
export const NEXT_STATUS = { todo: "doing", doing: "done", done: "todo" };

const DATE_FMT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const DATE_FMT_Y = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });

/** A day key ("2026-03-14") formatted for reading; adds the year only when it differs. */
export function fmtDay(dayKey) {
  const d = new Date(`${dayKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return (d.getFullYear() === new Date().getFullYear() ? DATE_FMT : DATE_FMT_Y).format(d);
}

/** True when a day key is strictly before today (local time). */
export function isPastDay(dayKey) {
  const d = new Date(`${dayKey}T23:59:59`);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}
