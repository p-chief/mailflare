"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authFetch } from "@/lib/auth/client";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { useSidebar } from "@/components/sidebar-state";
import { SidebarResizeBoundary } from "@/components/sidebar-resize-boundary";
import type { CalendarEvent, CalendarView, EventDragPreview, EventResizeEdge, EventResizeSession } from "./types";
import {
  addDays, CALENDAR_END_HOUR, CALENDAR_HOUR_HEIGHT, CALENDAR_START_HOUR,
  dateKey, dropStartForPosition, EVENT_COLORS, EVENT_COLOR_DOTS, eventPosition,
  formatEventRange, formatHour, formatLocalDateTime, groupUpcomingEvents,
  monthGridDates, resizeEventTimes, startOfDay, startOfWorkweek,
} from "./utils";
import clsx from "clsx";

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [visibleDate, setVisibleDate] = useState(() => new Date());
  const [view, setView] = useState<CalendarView>("week");
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(() => new Date());
  const monthPickerRef = useRef<HTMLDivElement | null>(null);
  const [headerTarget, setHeaderTarget] = useState<HTMLElement | null>(null);
  const [draggedEvent, setDraggedEvent] = useState<CalendarEvent | null>(null);
  const [resizingEvent, setResizingEvent] = useState<CalendarEvent | null>(null);
  const [dragPreview, setDragPreview] = useState<EventDragPreview | null>(null);
  const dragOffsetPixels = useRef(0);
  const resizeSession = useRef<EventResizeSession | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [title, setTitle] = useState("");
  const [color, setColor] = useState("blue");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [adding, setAdding] = useState(false);
  const [guests, setGuests] = useState("");
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [pendingAction, setPendingAction] = useState<"save" | string | null>(null);
  const { selectedMailbox } = useSelectedMailbox();
  const { minimal } = useSidebar();

  const today = useMemo(() => startOfDay(new Date()), []);
  const workweekStart = useMemo(() => startOfWorkweek(visibleDate), [visibleDate]);
  const days = useMemo(
    () => view === "day" ? [startOfDay(visibleDate)] : Array.from({ length: 5 }, (_, index) => addDays(workweekStart, index)),
    [view, visibleDate, workweekStart],
  );
  const upcomingGroups = useMemo(() => groupUpcomingEvents(events, today), [events, today]);
  const pickerDates = useMemo(() => monthGridDates(pickerMonth), [pickerMonth]);
  const previewEvent = useMemo(() => dragPreview && (draggedEvent || resizingEvent)
    ? {
      ...(draggedEvent || resizingEvent)!,
      startsAt: dragPreview.startsAt.toISOString(),
      endsAt: dragPreview.endsAt.toISOString(),
    }
    : null, [dragPreview, draggedEvent, resizingEvent]);
  const previewPosition = useMemo(() => dragPreview && previewEvent
    ? eventPosition(previewEvent, dragPreview.day)
    : null, [dragPreview, previewEvent]);

  useEffect(() => {
    setHeaderTarget(document.getElementById("calendar-header-slot"));
  }, []);

  useEffect(() => {
    if (!monthPickerOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!monthPickerRef.current?.contains(event.target as Node)) setMonthPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMonthPickerOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [monthPickerOpen]);

  useEffect(() => {
    const start = new Date(Math.min(today.getTime(), workweekStart.getTime(), startOfDay(visibleDate).getTime()));
    const end = new Date(Math.max(addDays(today, 90).getTime(), addDays(workweekStart, 7).getTime(), addDays(visibleDate, 1).getTime()));
    void authFetch(`/api/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}`)
      .then((response) => response.json())
      .then((data) => setEvents(data.events ?? []));
  }, [today, visibleDate, workweekStart]);

  function openNewEvent(day = visibleDate, startAt?: Date) {
    const start = startAt ? new Date(startAt) : new Date(day);
    if (!startAt) start.setHours(Math.min(Math.max(new Date().getHours() + 1, CALENDAR_START_HOUR), CALENDAR_END_HOUR - 1), 0, 0, 0);
    setEditing(null);
    setTitle("");
    setColor("blue");
    setGuests("");
    setStartsAt(formatLocalDateTime(start));
    setEndsAt(formatLocalDateTime(new Date(start.getTime() + 60 * 60_000)));
    setAdding(true);
  }

  async function addEvent() {
    setPendingAction("save");
    try {
      const response = await authFetch(editing ? `/api/calendar/events/${editing.id}` : "/api/calendar/events", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, startsAt, endsAt, color, attendees: guests.split(","),
          description: editing?.description ?? "",
          location: editing?.location ?? "",
          mailboxId: selectedMailbox?.id,
          from: selectedMailbox?.senderAddresses?.[0] ??
            (selectedMailbox ? `${selectedMailbox.localPart}@${selectedMailbox.hostname}` : ""),
        }),
      });
      const data = await response.json();
      if (response.ok) {
        setEvents((items) => (editing
          ? items.map((event) => event.id === editing.id ? {
            ...event, title, color,
            startsAt: new Date(startsAt).toISOString(),
            endsAt: new Date(endsAt).toISOString(),
            attendees: JSON.stringify(guests.split(",").filter(Boolean)),
          } : event)
          : [...items, data.event]
        ).sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
        setAdding(false);
        setEditing(null);
      }
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteEvent(id: string) {
    if (!window.confirm("Delete this event?")) return;
    setPendingAction(id);
    try {
      const response = await authFetch(`/api/calendar/events/${id}`, { method: "DELETE" });
      if (response.ok) {
        setEvents((items) => items.filter((event) => event.id !== id));
        setAdding(false);
        setEditing(null);
      }
    } finally {
      setPendingAction(null);
    }
  }

  function editEvent(event: CalendarEvent) {
    setEditing(event);
    setTitle(event.title);
    setColor(event.color ?? "blue");
    setStartsAt(formatLocalDateTime(new Date(event.startsAt)));
    setEndsAt(formatLocalDateTime(new Date(event.endsAt)));
    setGuests(JSON.parse(event.attendees || "[]").join(", "));
    setAdding(true);
  }

  async function saveEventTimes(event: CalendarEvent, startsAt: Date, endsAt: Date) {
    if (startsAt.getTime() === new Date(event.startsAt).getTime() && endsAt.getTime() === new Date(event.endsAt).getTime()) {
      setDraggedEvent(null);
      setResizingEvent(null);
      setDragPreview(null);
      return;
    }
    setPendingAction(event.id);
    setErrorMessage("");
    try {
      const response = await authFetch(`/api/calendar/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: event.title,
          description: event.description,
          location: event.location,
          attendees: JSON.parse(event.attendees || "[]"),
          color: event.color,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          from: selectedMailbox?.senderAddresses?.[0] ??
            (selectedMailbox ? `${selectedMailbox.localPart}@${selectedMailbox.hostname}` : ""),
        }),
      });
      if (!response.ok) {
        setErrorMessage("Could not update the event time. Please try again.");
        return;
      }
      setEvents((items) => items.map((item) => item.id === event.id
        ? { ...item, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }
        : item).sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
    } catch {
      setErrorMessage("Could not update the event time. Please try again.");
    } finally {
      setDraggedEvent(null);
      setResizingEvent(null);
      setDragPreview(null);
      setPendingAction(null);
    }
  }

  function moveEvent(event: CalendarEvent, day: Date, pixelsFromTop: number) {
    const startsAt = dropStartForPosition(day, pixelsFromTop);
    const endsAt = new Date(startsAt.getTime() + new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime());
    void saveEventTimes(event, startsAt, endsAt);
  }

  function startResize(pointerEvent: ReactPointerEvent<HTMLButtonElement>, event: CalendarEvent, day: Date, edge: EventResizeEdge) {
    if (pendingAction !== null) return;
    const column = pointerEvent.currentTarget.parentElement;
    if (!column) return;
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
    resizeSession.current = { event, day, edge, columnTop: column.getBoundingClientRect().top, pointerY: pointerEvent.clientY, moved: false };
    setResizingEvent(event);
    setDragPreview({ eventId: event.id, day, startsAt: new Date(event.startsAt), endsAt: new Date(event.endsAt) });
  }

  function updateResize(pointerEvent: ReactPointerEvent<HTMLButtonElement>) {
    const session = resizeSession.current;
    if (!session) return;
    if (Math.abs(pointerEvent.clientY - session.pointerY) < 3) return;
    session.moved = true;
    const times = resizeEventTimes(session.event, session.day, session.edge, pointerEvent.clientY - session.columnTop);
    setDragPreview({
      eventId: session.event.id,
      day: session.day,
      startsAt: times.startsAt,
      endsAt: times.endsAt,
    });
  }

  function finishResize(pointerEvent: ReactPointerEvent<HTMLButtonElement>) {
    const session = resizeSession.current;
    if (!session) return;
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
    resizeSession.current = null;
    if (!session.moved) {
      setResizingEvent(null);
      setDragPreview(null);
      return;
    }
    const times = resizeEventTimes(session.event, session.day, session.edge, pointerEvent.clientY - session.columnTop);
    void saveEventTimes(session.event, times.startsAt, times.endsAt);
  }

  function cancelResize() {
    resizeSession.current = null;
    setResizingEvent(null);
    setDragPreview(null);
  }

  return (
    <div className={clsx("flex h-full min-h-0 flex-col bg-[#f6f8fc] pl-3 lg:flex-row transition-[gap] duration-200 ease-in-out motion-reduce:transition-none", minimal ? "gap-0" : "gap-3")}>
      {headerTarget && createPortal(
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <div ref={monthPickerRef} className="relative shrink-0">
            <button type="button" onClick={() => {
              setPickerMonth(new Date(visibleDate.getFullYear(), visibleDate.getMonth(), 1));
              setMonthPickerOpen((open) => !open);
            }} className="flex items-center gap-2 whitespace-nowrap text-lg font-semibold text-neutral-900" aria-haspopup="dialog" aria-expanded={monthPickerOpen}>
              {visibleDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              <ChevronDown className="h-5 w-5 text-neutral-500" />
            </button>
            {monthPickerOpen && (
              <div role="dialog" aria-label="Choose a calendar date" className="absolute left-0 top-full z-50 mt-3 w-[448px] max-w-[calc(100vw-24px)] rounded-2xl bg-[#f7f9fc] p-5 shadow-xl ring-1 ring-neutral-200/70">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold text-neutral-900">
                    {pickerMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                  </h2>
                  <div className="flex items-center gap-2">
                    <button type="button" aria-label="Previous month" onClick={() => setPickerMonth(new Date(pickerMonth.getFullYear(), pickerMonth.getMonth() - 1, 1))} className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-200/70">
                      <ChevronLeft className="h-6 w-6" />
                    </button>
                    <button type="button" aria-label="Next month" onClick={() => setPickerMonth(new Date(pickerMonth.getFullYear(), pickerMonth.getMonth() + 1, 1))} className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-200/70">
                      <ChevronRight className="h-6 w-6" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-7">
                  {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((weekday) => (
                    <span key={weekday} aria-label={weekday} className="flex h-10 items-center justify-center text-sm font-medium text-neutral-500">{weekday[0]}</span>
                  ))}
                  {pickerDates.map((day) => {
                    const selected = dateKey(day) === dateKey(visibleDate);
                    const isToday = dateKey(day) === dateKey(today);
                    const outsideMonth = day.getMonth() !== pickerMonth.getMonth();
                    return (
                      <button key={dateKey(day)} type="button" aria-label={day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} aria-pressed={selected}
                        onClick={() => { setVisibleDate(day); setMonthPickerOpen(false); }}
                        className={clsx("mx-auto my-0.5 flex h-11 w-11 items-center justify-center rounded-full text-base font-medium hover:bg-neutral-200/80",
                          selected ? "bg-blue-600 text-white hover:bg-blue-600" : isToday ? "bg-neutral-200 text-neutral-900" : outsideMonth ? "text-neutral-400" : "text-neutral-900")}>
                        {day.getDate()}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" aria-label={`Previous ${view}`} onClick={() => setVisibleDate(addDays(visibleDate, view === "week" ? -7 : -1))} className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-600 hover:bg-white"><ChevronLeft className="h-6 w-6" /></button>
            <button type="button" aria-label={`Next ${view}`} onClick={() => setVisibleDate(addDays(visibleDate, view === "week" ? 7 : 1))} className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-600 hover:bg-white"><ChevronRight className="h-6 w-6" /></button>
            <button type="button" onClick={() => setVisibleDate(new Date())} className="h-10 rounded-full bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50">Today</button>
            <div className="relative">
              <select value={view} onChange={(event) => setView(event.target.value as CalendarView)} aria-label="Calendar view" className="h-10 appearance-none rounded-full border-0 bg-white pl-4 pr-10 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
                <option value="week">Week</option>
                <option value="day">Day</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-600" />
            </div>
            <Button disabled={pendingAction !== null} onClick={() => openNewEvent()} className="ml-1 h-10 rounded-full bg-blue-600 px-4 text-white hover:bg-neutral-50"><Plus className="h-5 w-5" />New event</Button>
          </div>
        </div>,
        headerTarget,
      )}
      <aside className={clsx("relative shrink-0 rounded-t-3xl bg-white transition-[width,max-height] duration-200 ease-in-out motion-reduce:transition-none lg:h-full lg:max-h-none", minimal ? "w-0 max-h-0" : "w-full max-h-[36vh] lg:w-[var(--sidebar-width)]")} aria-hidden={minimal}>
        {!minimal && (
          <div className="h-full overflow-y-auto overscroll-contain rounded-t-3xl px-5 py-5">
            {upcomingGroups.length === 0 ? (
              <div>
                <h2 className="text-lg font-semibold text-neutral-900">Upcoming</h2>
                <p className="mt-4 text-sm text-neutral-400">No upcoming events.</p>
              </div>
            ) : upcomingGroups.map((group) => (
              <section key={group.key} className="mb-6 last:mb-0">
                <h2 className="mb-3 text-base font-semibold text-neutral-900">{group.label}</h2>
                <div className="space-y-2">
                  {group.events.map((event) => (
                    <button key={event.id} type="button" onClick={() => editEvent(event)} className="group flex w-full items-start gap-3 text-left">
                      <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-white ring-1 ring-neutral-200 ${EVENT_COLOR_DOTS[event.color as keyof typeof EVENT_COLOR_DOTS] ?? EVENT_COLOR_DOTS.blue}`} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-neutral-700 group-hover:text-neutral-950">{event.title}</span>
                        <span className="block text-xs text-neutral-400">{formatEventRange(event)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
        {!minimal && <div className="hidden lg:block"><SidebarResizeBoundary /></div>}
      </aside>

      <section className="min-h-0 min-w-0 flex-1 rounded-t-3xl bg-white flex flex-col overflow-hidden">
        {errorMessage && <div role="alert" className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{errorMessage}</div>}
        <div className="sticky top-0 z-30 grid border-b border-neutral-200 bg-white h-14" style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div />
          {days.map((day) => (
            <div key={dateKey(day)} className={`border-l border-neutral-100 px-3 py-2 text-xs ${dateKey(day) === dateKey(today) ? "text-blue-600" : "text-neutral-500"}`}>
              {day.toLocaleDateString(undefined, { weekday: "short" })}
              <b className="text-xl block">
                {day.toLocaleDateString(undefined, { day: "numeric" })}
              </b>
            </div>
          ))}
        </div>
        <div className={clsx("overflow-auto overscroll-contain flex-1 min-h-0", view === "week" ? "min-w-190" : "min-w-90")}>

          <div className="grid" style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))`, height: (CALENDAR_END_HOUR - CALENDAR_START_HOUR) * CALENDAR_HOUR_HEIGHT }}>
            <div className="relative">
              {Array.from({ length: CALENDAR_END_HOUR - CALENDAR_START_HOUR }, (_, index) => (
                <span key={index} className={`absolute right-3 text-xs text-neutral-700 ${index === 0 ? "" : "-translate-y-1/2"}`} style={{ top: index * CALENDAR_HOUR_HEIGHT }}>{index % 2 == 0 ? null : formatHour(CALENDAR_START_HOUR + index)}</span>
              ))}
            </div>
            {days.map((day) => (
              <div key={dateKey(day)} className="relative border-l border-neutral-100"
                onDragOver={(event) => {
                  if (!draggedEvent) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  const start = dropStartForPosition(day, event.clientY - event.currentTarget.getBoundingClientRect().top - dragOffsetPixels.current);
                  const end = new Date(start.getTime() + new Date(draggedEvent.endsAt).getTime() - new Date(draggedEvent.startsAt).getTime());
                  setDragPreview((current) => current?.eventId === draggedEvent.id && dateKey(current.day) === dateKey(day) && current.startsAt.getTime() === start.getTime()
                    ? current : { eventId: draggedEvent.id, day, startsAt: start, endsAt: end });
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedEvent) void moveEvent(draggedEvent, day, event.clientY - event.currentTarget.getBoundingClientRect().top - dragOffsetPixels.current);
                }}
                style={{ backgroundImage: "linear-gradient(to bottom, transparent calc(100% - 1px), #f0f0f0 calc(100% - 1px))", backgroundSize: `100% ${CALENDAR_HOUR_HEIGHT}px` }}>
                <button type="button" aria-label={`Add event on ${day.toLocaleDateString()}`} onClick={(event) => openNewEvent(day, dropStartForPosition(day, event.nativeEvent.offsetY))} className="absolute inset-0 z-0 cursor-crosshair" />
                {events.filter((event) => new Date(event.startsAt) < addDays(day, 1) && new Date(event.endsAt) > day).map((event) => {
                  const position = eventPosition(event, day);
                  if (!position) return null;
                  const color = EVENT_COLORS[event.color as keyof typeof EVENT_COLORS] ?? EVENT_COLORS.blue;
                  const canResizeStart = dateKey(new Date(event.startsAt)) === dateKey(day);
                  const canResizeEnd = new Date(event.endsAt).getTime() <= addDays(day, 1).getTime();
                  return (
                    <Fragment key={event.id}>
                      <button type="button" draggable={pendingAction === null} onClick={() => editEvent(event)}
                        onDragStart={(dragEvent) => { dragOffsetPixels.current = dragEvent.clientY - dragEvent.currentTarget.getBoundingClientRect().top; dragEvent.dataTransfer.setData("text/plain", event.id); dragEvent.dataTransfer.effectAllowed = "move"; setDraggedEvent(event); }}
                        onDragEnd={() => { setDraggedEvent(null); setDragPreview(null); }}
                        title={`${event.title} · ${formatEventRange(event)}`}
                        className={`absolute left-1 right-1 z-10 flex cursor-move flex-col items-start justify-start overflow-hidden rounded-lg pr-2 pl-4 text-left hover:brightness-95 ${position.height >= 20 ? "py-1.5" : "py-0"} ${draggedEvent?.id === event.id || resizingEvent?.id === event.id ? "opacity-40" : ""} ${color}`}
                        style={{ top: position.top, height: position.height }}>
                          <span className={clsx("absolute top-1 left-1 border-l-4 rounded-xl w-1 h-[calc(100%-8px)] block bg-amber-400", color)} />
                        {position.height >= 15 && <span className="block w-full truncate text-[12px] font-semibold leading-4">{event.title}</span>}
                        {position.height >= 34 && <span className="block w-full truncate text-[11px] leading-4 opacity-70">{formatEventRange(event)}</span>}
                      </button>
                      {(["start", "end"] as const).filter((edge) => edge === "start" ? canResizeStart : canResizeEnd).map((edge) => (
                        <button key={edge} type="button" draggable={false}
                          aria-label={`Resize ${edge} of ${event.title}`}
                          onPointerDown={(pointerEvent) => startResize(pointerEvent, event, day, edge)}
                          onPointerMove={updateResize}
                          onPointerUp={finishResize}
                          onPointerCancel={cancelResize}
                          onClick={(clickEvent) => clickEvent.stopPropagation()}
                          className={clsx(edge === "start" ? "cursor-n-resize" : "cursor-s-resize", "absolute left-1 right-1 z-20 h-2 touch-none bg-transparent focus-visible:outline-2 focus-visible:outline-blue-500")}
                          style={{ top: edge === "start" ? position.top - 4 : position.top + position.height - 4 }} />
                      ))}
                    </Fragment>
                  );
                })}
                {dragPreview && previewEvent && previewPosition && dateKey(dragPreview.day) === dateKey(day) && (
                  <div className={`pointer-events-none absolute left-1 right-1 z-20 rounded-lg border-2 border-dashed opacity-80 ${EVENT_COLORS[previewEvent.color as keyof typeof EVENT_COLORS] ?? EVENT_COLORS.blue}`}
                    style={{ top: previewPosition.top, height: previewPosition.height }}>
                    <span className="absolute left-1 top-0 z-10 whitespace-nowrap rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      {formatEventRange(previewEvent)}
                    </span>
                    {previewPosition.height >= 50 && <span className="block truncate px-2 pt-6 text-[12px] font-semibold">{previewEvent.title}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/35 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-semibold">{editing ? "Edit event" : "Create event"}</h2>
            <div className="mt-5 grid gap-3">
              <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Event title" />
              <Input value={guests} onChange={(event) => setGuests(event.target.value)} placeholder="Add guests (comma-separated emails)" />
              <div>
                <span className="mb-2 block text-sm font-medium text-neutral-700">Color</span>
                <div role="radiogroup" aria-label="Event color" className="flex items-center gap-2">
                  {Object.entries(EVENT_COLOR_DOTS).map(([value, dotClass]) => (
                    <button key={value} type="button" role="radio" aria-label={value} aria-checked={color === value} onClick={() => setColor(value)}
                      className={`flex h-8 w-8 items-center justify-center rounded-full ${color === value ? "ring-2 ring-neutral-700 ring-offset-2" : "hover:ring-2 hover:ring-neutral-200"}`}>
                      <span className={`h-6 w-6 rounded-full ${dotClass}`} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} aria-label="Start date and time" />
                <Input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} aria-label="End date and time" />
              </div>
              <div className="mt-2 flex justify-between gap-2">
                <div>{editing && <Button variant="ghost" disabled={pendingAction !== null} onClick={() => void deleteEvent(editing.id)} className="text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" />Delete</Button>}</div>
                <div className="flex gap-2">
                  <Button variant="ghost" disabled={pendingAction === "save"} onClick={() => { setEditing(null); setAdding(false); }}>Cancel</Button>
                  <Button onClick={() => void addEvent()} disabled={!title || !startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt) || pendingAction === "save"}>
                    {pendingAction === "save" ? "Saving..." : editing ? "Save changes" : "Create event"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
