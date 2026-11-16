import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Lock,
  Plus,
  Trash2,
} from 'lucide-react';
import { AppTab, Customer, Project, TaskType, TimeEntry } from '../types/timeTracking';
import { deleteTimeEntry, updateTimeEntry } from '../lib/firestoreService';
import {
  formatHours,
  formatHoursAndMinutes,
  formatHoursPlain,
  formatMonthLabel,
  formatSEK,
  getMonthKey,
  toIsoDate,
  todayIsoDate,
} from '../lib/formatters';
import { EntryCreateModal } from './EntryCreateModal';
import { EntryEditModal } from './EntryEditModal';
import { MultiSelectFilter } from './MultiSelectFilter';

interface DashboardViewProps {
  uid: string;
  customers: Customer[];
  projects: Project[];
  taskTypes: TaskType[];
  entries: TimeEntry[];
  loading: boolean;
  onNavigate: (tab: AppTab) => void;
}

type CalendarViewMode = 'week' | 'month';
type BreakdownMode = 'project' | 'customer' | 'task';

const WEEKDAY_SHORT = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];

function parseIsoLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0=Sun, 1=Mon
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function getIsoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return `rgba(15, 118, 110, ${alpha})`;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return `rgba(15, 118, 110, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const PX_PER_HOUR = 48;

function parseTimeToMinutes(timeStr: string): number | null {
  if (!timeStr || !/^\d{1,2}:\d{2}$/.test(timeStr)) return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function formatMinutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 45, totalMinutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatEndMinutesToTime(totalMinutes: number): string {
  if (totalMinutes >= 24 * 60) return '24:00';
  return formatMinutesToTime(totalMinutes);
}

interface PositionedEntry {
  entry: TimeEntry;
  startMin: number;
  endMin: number;
  colIndex: number;
  colCount: number;
}

function layoutDayEntriesForWeek(dayEntries: TimeEntry[]): PositionedEntry[] {
  const timed: { entry: TimeEntry; startMin: number; endMin: number; visualEndMin: number }[] = [];
  const untimed: TimeEntry[] = [];

  for (const entry of dayEntries) {
    const start = parseTimeToMinutes(entry.startTime);
    const durMin = Math.max(15, Math.round(entry.hours * 60));
    if (start !== null) {
      const endMin = Math.min(24 * 60, start + durMin);
      timed.push({
        entry,
        startMin: start,
        endMin,
        visualEndMin: Math.max(endMin, start + 30),
      });
    } else {
      untimed.push(entry);
    }
  }

  // Place untimed entries sequentially starting at 08:00, skipping occupied timed intervals
  let cursorMin = 8 * 60;
  const occupied = [...timed].sort((a, b) => a.startMin - b.startMin);
  const allItems = [...timed];

  for (const entry of untimed) {
    const durMin = Math.max(15, Math.round(entry.hours * 60));
    let placedStart = cursorMin;
    for (const block of occupied) {
      if (placedStart < block.visualEndMin && placedStart + durMin > block.startMin) {
        placedStart = Math.max(placedStart, block.visualEndMin);
      }
    }
    if (placedStart >= 24 * 60) {
      placedStart = Math.max(0, 24 * 60 - durMin);
    }
    const placedEnd = Math.min(24 * 60, placedStart + durMin);
    allItems.push({
      entry,
      startMin: placedStart,
      endMin: placedEnd,
      visualEndMin: Math.max(placedEnd, placedStart + 30),
    });
    cursorMin = placedEnd;
  }

  allItems.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  // Assign columns within overlapping clusters so simultaneous/overlapping entries sit side-by-side
  const result: PositionedEntry[] = [];
  let cluster: { entry: TimeEntry; startMin: number; endMin: number; visualEndMin: number }[] = [];
  let clusterEnd = -1;

  const flushCluster = (
    items: { entry: TimeEntry; startMin: number; endMin: number; visualEndMin: number }[]
  ) => {
    if (items.length === 0) return;
    const colEndTimes: number[] = [];
    const assigned: { entry: TimeEntry; startMin: number; endMin: number; colIndex: number }[] = [];

    for (const item of items) {
      let col = colEndTimes.findIndex((end) => end <= item.startMin);
      if (col === -1) {
        col = colEndTimes.length;
        colEndTimes.push(item.visualEndMin);
      } else {
        colEndTimes[col] = item.visualEndMin;
      }
      assigned.push({ entry: item.entry, startMin: item.startMin, endMin: item.endMin, colIndex: col });
    }
    const colCount = Math.max(1, colEndTimes.length);
    for (const a of assigned) {
      result.push({ ...a, colCount });
    }
  };

  for (const item of allItems) {
    if (cluster.length === 0 || item.startMin < clusterEnd) {
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.visualEndMin);
    } else {
      flushCluster(cluster);
      cluster = [item];
      clusterEnd = item.visualEndMin;
    }
  }
  flushCluster(cluster);

  return result;
}

export function DashboardView({
  uid,
  customers,
  projects,
  taskTypes,
  entries,
  loading,
  onNavigate,
}: DashboardViewProps) {
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week');
  const [anchorDate, setAnchorDate] = useState<string>(() => todayIsoDate());
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>('project');
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<TimeEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [createModalState, setCreateModalState] = useState<{
    date: string;
    startTime?: string;
    endTime?: string;
  } | null>(null);

  const [filterCustomerIds, setFilterCustomerIds] = useState<string[]>([]);
  const [filterProjectIds, setFilterProjectIds] = useState<string[]>([]);
  const [filterTaskNames, setFilterTaskNames] = useState<string[]>([]);

  const [calendarMoveError, setCalendarMoveError] = useState<string | null>(null);
  const [draggingEntryId, setDraggingEntryId] = useState<string | null>(null);
  const [weekDropPreview, setWeekDropPreview] = useState<{
    date: string;
    startMin: number;
    endMin: number;
    color: string;
    title: string;
  } | null>(null);
  const [monthDropDate, setMonthDropDate] = useState<string | null>(null);
  const [dragCreatePreview, setDragCreatePreview] = useState<{
    date: string;
    startMin: number;
    endMin: number;
  } | null>(null);
  const [resizePreview, setResizePreview] = useState<{
    entryId: string;
    startMin: number;
    endMin: number;
  } | null>(null);

  const dragMoveRef = useRef<{
    entry: TimeEntry;
    grabOffsetY: number;
    durationMin: number;
    color: string;
    title: string;
  } | null>(null);

  const dragCreateRef = useRef<{
    date: string;
    colTop: number;
    minHour: number;
    anchorMin: number;
    currentMin: number;
    startY: number;
    hasMoved: boolean;
  } | null>(null);

  const resizeRef = useRef<{
    entry: TimeEntry;
    edge: 'top' | 'bottom';
    colTop: number;
    minHour: number;
    initialStartMin: number;
    initialEndMin: number;
    currentStartMin: number;
    currentEndMin: number;
  } | null>(null);

  const customersMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const projectsMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(id);
  }, []);

  const todayStr = useMemo(() => toIsoDate(now), [now]);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const anchorDt = useMemo(() => parseIsoLocal(anchorDate), [anchorDate]);
  const selectedMonthKey = useMemo(() => getMonthKey(anchorDt), [anchorDt]);

  const shiftPeriod = (delta: number) => {
    const dt = new Date(anchorDt);
    if (viewMode === 'week') {
      dt.setDate(dt.getDate() + delta * 7);
    } else {
      dt.setMonth(dt.getMonth() + delta);
    }
    setAnchorDate(toIsoDate(dt));
  };

  // Build days for Week view (7 days Mon-Sun) or Month view (full calendar grid Mon-Sun)
  const calendarDays = useMemo(() => {
    if (viewMode === 'week') {
      const monday = getMondayOfWeek(anchorDt);
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return {
          iso: toIsoDate(d),
          dayNum: d.getDate(),
          weekdayLabel: WEEKDAY_SHORT[i],
          inCurrentMonth: true,
        };
      });
    }

    const firstOfMonth = new Date(anchorDt.getFullYear(), anchorDt.getMonth(), 1);
    const lastOfMonth = new Date(anchorDt.getFullYear(), anchorDt.getMonth() + 1, 0);
    const gridStart = getMondayOfWeek(firstOfMonth);
    const lastDayDow = lastOfMonth.getDay(); // 0=Sun
    const daysAfter = lastDayDow === 0 ? 0 : 7 - lastDayDow;
    const gridEnd = new Date(lastOfMonth);
    gridEnd.setDate(lastOfMonth.getDate() + daysAfter);

    const days: {
      iso: string;
      dayNum: number;
      weekdayLabel: string;
      inCurrentMonth: boolean;
    }[] = [];

    const cursor = new Date(gridStart);
    while (cursor <= gridEnd) {
      const idx = (cursor.getDay() + 6) % 7;
      days.push({
        iso: toIsoDate(cursor),
        dayNum: cursor.getDate(),
        weekdayLabel: WEEKDAY_SHORT[idx],
        inCurrentMonth: cursor.getMonth() === anchorDt.getMonth(),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }, [viewMode, anchorDt]);

  // Period bounds for KPIs and breakdown
  const periodBounds = useMemo(() => {
    if (viewMode === 'week') {
      const start = calendarDays[0]?.iso || anchorDate;
      const end = calendarDays[calendarDays.length - 1]?.iso || anchorDate;
      const weekNum = getIsoWeekNumber(anchorDt);
      const startDt = parseIsoLocal(start);
      const endDt = parseIsoLocal(end);
      const fmt = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' });
      return {
        start,
        end,
        label: `Vecka ${weekNum} (${fmt.format(startDt)} – ${fmt.format(endDt)})`,
        shortPeriodName: 'denna vecka',
      };
    }
    const first = new Date(anchorDt.getFullYear(), anchorDt.getMonth(), 1);
    const last = new Date(anchorDt.getFullYear(), anchorDt.getMonth() + 1, 0);
    return {
      start: toIsoDate(first),
      end: toIsoDate(last),
      label: formatMonthLabel(selectedMonthKey),
      shortPeriodName: 'denna månad',
    };
  }, [viewMode, calendarDays, anchorDate, anchorDt, selectedMonthKey]);

  const filterProjectOptions = useMemo(() => {
    if (filterCustomerIds.length === 0) return projects;
    return projects.filter((p) => filterCustomerIds.includes(p.customerId));
  }, [projects, filterCustomerIds]);

  const filterTaskOptions = useMemo(() => {
    const names = new Set<string>();
    for (const t of taskTypes) {
      if (t.name) names.add(t.name);
    }
    for (const e of entries) {
      if (e.taskName) names.add(e.taskName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'sv'));
  }, [taskTypes, entries]);

  const hasActiveFilters =
    filterCustomerIds.length > 0 ||
    filterProjectIds.length > 0 ||
    filterTaskNames.length > 0;

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (filterCustomerIds.length > 0 && !filterCustomerIds.includes(e.customerId)) {
        return false;
      }
      if (filterProjectIds.length > 0 && !filterProjectIds.includes(e.projectId)) {
        return false;
      }
      if (
        filterTaskNames.length > 0 &&
        !filterTaskNames.includes(e.taskName || 'Allmänt arbete')
      ) {
        return false;
      }
      return true;
    });
  }, [entries, filterCustomerIds, filterProjectIds, filterTaskNames]);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, TimeEntry[]>();
    for (const e of filteredEntries) {
      const list = map.get(e.date) || [];
      list.push(e);
      map.set(e.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99'));
    }
    return map;
  }, [filteredEntries]);

  const weekLayoutByDate = useMemo(() => {
    const layoutMap = new Map<string, PositionedEntry[]>();
    let minHour = 7;
    let maxHour = 19;

    if (viewMode === 'week') {
      for (const day of calendarDays) {
        if (day.iso === todayStr) {
          const currentHour = Math.floor(nowMinutes / 60);
          minHour = Math.min(minHour, currentHour);
          maxHour = Math.max(maxHour, currentHour + 1);
        }
        const dayEntries = entriesByDate.get(day.iso) || [];
        const laidOut = layoutDayEntriesForWeek(dayEntries);
        layoutMap.set(day.iso, laidOut);
        for (const item of laidOut) {
          minHour = Math.min(minHour, Math.floor(item.startMin / 60));
          maxHour = Math.max(maxHour, Math.ceil(item.endMin / 60));
        }
      }
    }

    minHour = Math.max(0, minHour);
    maxHour = Math.min(24, Math.max(minHour + 1, maxHour));
    const hoursRange = Array.from({ length: maxHour - minHour }, (_, i) => minHour + i);

    return { layoutMap, minHour, maxHour, hoursRange };
  }, [viewMode, calendarDays, entriesByDate, todayStr, nowMinutes]);

  const monthWeeks = useMemo(() => {
    if (viewMode !== 'month') return [];
    const weeks: { weekNum: number; days: typeof calendarDays }[] = [];
    for (let i = 0; i < calendarDays.length; i += 7) {
      const slice = calendarDays.slice(i, i + 7);
      const firstDay = slice[0] ? parseIsoLocal(slice[0].iso) : anchorDt;
      weeks.push({
        weekNum: getIsoWeekNumber(firstDay),
        days: slice,
      });
    }
    return weeks;
  }, [viewMode, calendarDays, anchorDt]);

  const periodEntries = useMemo(
    () => filteredEntries.filter((e) => e.date >= periodBounds.start && e.date <= periodBounds.end),
    [filteredEntries, periodBounds]
  );

  const handleWeekGridDoubleClick = (
    isoDate: string,
    e: React.MouseEvent<HTMLDivElement>
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = Math.max(0, e.clientY - rect.top);
    const totalMinutesRaw =
      weekLayoutByDate.minHour * 60 + (offsetY / PX_PER_HOUR) * 60;
    let snappedStart = Math.floor(totalMinutesRaw / 15) * 15;
    snappedStart = Math.max(0, Math.min(22 * 60 + 45, snappedStart));
    const snappedEnd = Math.min(23 * 60 + 45, snappedStart + 60);

    setCreateModalState({
      date: isoDate,
      startTime: formatMinutesToTime(snappedStart),
      endTime: formatMinutesToTime(snappedEnd),
    });
  };

  useEffect(() => {
    const computeRange = (anchorMin: number, currentMin: number) => {
      if (currentMin >= anchorMin) {
        const startMin = Math.min(23 * 60 + 45, anchorMin);
        const endMin = Math.min(24 * 60, Math.max(startMin + 15, currentMin));
        return { startMin, endMin };
      }
      const startMin = Math.max(0, Math.min(23 * 60 + 45, currentMin));
      const endMin = Math.min(24 * 60, Math.max(startMin + 15, anchorMin + 15));
      return { startMin, endMin };
    };

    const handleMouseMove = (ev: MouseEvent) => {
      const active = dragCreateRef.current;
      if (!active) return;

      if (!active.hasMoved && Math.abs(ev.clientY - active.startY) >= 8) {
        active.hasMoved = true;
      }
      if (!active.hasMoved) return;

      const offsetY = Math.max(0, ev.clientY - active.colTop);
      const rawMin = active.minHour * 60 + (offsetY / PX_PER_HOUR) * 60;
      const snappedMin = Math.max(0, Math.min(24 * 60, Math.round(rawMin / 15) * 15));
      active.currentMin = snappedMin;

      const { startMin, endMin } = computeRange(active.anchorMin, snappedMin);
      setDragCreatePreview((prev) => {
        if (
          prev &&
          prev.date === active.date &&
          prev.startMin === startMin &&
          prev.endMin === endMin
        ) {
          return prev;
        }
        return { date: active.date, startMin, endMin };
      });
    };

    const handleMouseUp = () => {
      const active = dragCreateRef.current;
      if (!active) return;
      dragCreateRef.current = null;
      setDragCreatePreview(null);

      if (!active.hasMoved) return;
      const { startMin, endMin } = computeRange(active.anchorMin, active.currentMin);
      setCreateModalState({
        date: active.date,
        startTime: formatMinutesToTime(startMin),
        endTime: formatEndMinutesToTime(endMin),
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleWeekGridMouseDown = (
    isoDate: string,
    e: React.MouseEvent<HTMLDivElement>
  ) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = Math.max(0, e.clientY - rect.top);
    const totalMinutesRaw =
      weekLayoutByDate.minHour * 60 + (offsetY / PX_PER_HOUR) * 60;
    const anchorMin = Math.max(
      0,
      Math.min(23 * 60 + 45, Math.floor(totalMinutesRaw / 15) * 15)
    );
    dragCreateRef.current = {
      date: isoDate,
      colTop: rect.top,
      minHour: weekLayoutByDate.minHour,
      anchorMin,
      currentMin: Math.min(24 * 60, anchorMin + 15),
      startY: e.clientY,
      hasMoved: false,
    };
  };

  const handleMoveEntry = async (
    entry: TimeEntry,
    targetDate: string,
    nextStartTime: string,
    nextEndTime: string
  ) => {
    if (entry.invoiced) return;
    if (
      entry.date === targetDate &&
      entry.startTime === nextStartTime &&
      entry.endTime === nextEndTime
    ) {
      return;
    }
    setCalendarMoveError(null);
    try {
      await updateTimeEntry(entry.id, {
        customerId: entry.customerId,
        projectId: entry.projectId,
        taskTypeId: entry.taskTypeId,
        taskName: entry.taskName,
        date: targetDate,
        startTime: nextStartTime,
        endTime: nextEndTime,
        hours: entry.hours,
        hourlyRate: entry.hourlyRate,
        billable: entry.billable,
        description: entry.description,
      });
    } catch (err) {
      setCalendarMoveError(
        err instanceof Error ? err.message : 'Kunde inte flytta tidsregistreringen.'
      );
    }
  };

  useEffect(() => {
    const handleResizeMouseMove = (ev: MouseEvent) => {
      const active = resizeRef.current;
      if (!active) return;

      const offsetY = Math.max(0, ev.clientY - active.colTop);
      const rawMin = active.minHour * 60 + (offsetY / PX_PER_HOUR) * 60;
      const snappedMin = Math.round(rawMin / 15) * 15;

      let nextStartMin = active.currentStartMin;
      let nextEndMin = active.currentEndMin;

      if (active.edge === 'bottom') {
        nextEndMin = Math.max(
          active.currentStartMin + 15,
          Math.min(24 * 60, snappedMin)
        );
      } else {
        nextStartMin = Math.max(
          0,
          Math.min(active.currentEndMin - 15, snappedMin)
        );
      }

      if (nextStartMin === active.currentStartMin && nextEndMin === active.currentEndMin) {
        return;
      }
      active.currentStartMin = nextStartMin;
      active.currentEndMin = nextEndMin;
      setResizePreview({
        entryId: active.entry.id,
        startMin: nextStartMin,
        endMin: nextEndMin,
      });
    };

    const handleResizeMouseUp = () => {
      const active = resizeRef.current;
      if (!active) return;
      resizeRef.current = null;
      setResizePreview(null);

      const nextStartMin = active.currentStartMin;
      const nextEndMin = active.currentEndMin;
      if (
        nextStartMin === active.initialStartMin &&
        nextEndMin === active.initialEndMin
      ) {
        return;
      }

      const nextHours = Math.min(
        24,
        Math.max(0.25, Math.round(((nextEndMin - nextStartMin) / 60) * 4) / 4)
      );

      setCalendarMoveError(null);
      void updateTimeEntry(active.entry.id, {
        customerId: active.entry.customerId,
        projectId: active.entry.projectId,
        taskTypeId: active.entry.taskTypeId,
        taskName: active.entry.taskName,
        date: active.entry.date,
        startTime: formatMinutesToTime(nextStartMin),
        endTime: formatEndMinutesToTime(nextEndMin),
        hours: nextHours,
        hourlyRate: active.entry.hourlyRate,
        billable: active.entry.billable,
        description: active.entry.description,
      }).catch((err) => {
        setCalendarMoveError(
          err instanceof Error ? err.message : 'Kunde inte ändra längden på tidsregistreringen.'
        );
      });
    };

    window.addEventListener('mousemove', handleResizeMouseMove);
    window.addEventListener('mouseup', handleResizeMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleResizeMouseMove);
      window.removeEventListener('mouseup', handleResizeMouseUp);
    };
  }, []);

  const handleResizeMouseDown = (
    entry: TimeEntry,
    edge: 'top' | 'bottom',
    startMin: number,
    endMin: number,
    e: React.MouseEvent<HTMLDivElement>
  ) => {
    if (entry.invoiced || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const colEl = e.currentTarget.closest('[data-week-day-col="true"]');
    if (!colEl) return;
    const colRect = colEl.getBoundingClientRect();
    resizeRef.current = {
      entry,
      edge,
      colTop: colRect.top,
      minHour: weekLayoutByDate.minHour,
      initialStartMin: startMin,
      initialEndMin: endMin,
      currentStartMin: startMin,
      currentEndMin: endMin,
    };
    setResizePreview({
      entryId: entry.id,
      startMin,
      endMin,
    });
  };

  // Uses each entry's locked hourlyRate snapshot; never recalculates invoiced entries
  const periodStats = useMemo(() => {
    let totalHours = 0;
    let billableHours = 0;
    let totalEarned = 0;
    let invoicedEarned = 0;
    let unbilledEarned = 0;
    for (const e of periodEntries) {
      totalHours += e.hours;
      if (e.billable) {
        const amt = e.hours * e.hourlyRate;
        billableHours += e.hours;
        totalEarned += amt;
        if (e.invoiced) invoicedEarned += amt;
        else unbilledEarned += amt;
      }
    }
    const avgRate = billableHours > 0 ? totalEarned / billableHours : 0;
    return { totalHours, billableHours, totalEarned, invoicedEarned, unbilledEarned, avgRate };
  }, [periodEntries]);

  const breakdownRows = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        name: string;
        subtitle: string;
        color: string;
        hours: number;
        billableHours: number;
        earned: number;
        invoicedEarned: number;
        entriesCount: number;
      }
    >();

    for (const e of periodEntries) {
      const cust = customersMap.get(e.customerId);
      const proj = projectsMap.get(e.projectId);
      let key = '';
      let name = '';
      let subtitle = '';
      let color = '#0F766E';

      if (breakdownMode === 'project') {
        key = e.projectId;
        name = proj?.name || 'Borttaget projekt';
        subtitle = cust?.name || 'Okänd kund';
        color = proj?.color || '#0F766E';
      } else if (breakdownMode === 'customer') {
        key = e.customerId;
        name = cust?.name || 'Okänd kund';
        subtitle = `${projects.filter((p) => p.customerId === e.customerId && p.status === 'active').length} aktiva projekt`;
        color = '#0F766E';
      } else {
        key = e.taskName || 'Allmänt arbete';
        name = key;
        subtitle = 'Arbetsuppgift';
        color = '#334155';
      }

      const row = map.get(key) || {
        key,
        name,
        subtitle,
        color,
        hours: 0,
        billableHours: 0,
        earned: 0,
        invoicedEarned: 0,
        entriesCount: 0,
      };
      row.hours += e.hours;
      if (e.billable) {
        const amt = e.hours * e.hourlyRate;
        row.billableHours += e.hours;
        row.earned += amt;
        if (e.invoiced) row.invoicedEarned += amt;
      }
      row.entriesCount += 1;
      map.set(key, row);
    }

    return Array.from(map.values()).sort((a, b) => b.earned - a.earned || b.hours - a.hours);
  }, [periodEntries, breakdownMode, customersMap, projectsMap, projects]);

  const maxEarned = useMemo(
    () => Math.max(1, ...breakdownRows.map((r) => r.earned)),
    [breakdownRows]
  );

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6 animate-pulse">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-white border border-slate-200 rounded-xl" />
          ))}
        </div>
        <div className="h-96 bg-white border border-slate-200 rounded-xl" />
      </div>
    );
  }

  const isSetupEmpty = customers.length === 0 || projects.length === 0;

  return (
    <div className="space-y-6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Översikt
          </h1>
        </div>

        {isSetupEmpty && (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div className="space-y-1.5 max-w-xl">
              <h2 className="text-lg font-semibold text-slate-900">
                Kom igång med kunder, projekt och uppgifter
              </h2>
              <p className="text-sm text-slate-600">
                Lägg till dina kunder, projekt och arbetsuppgifter med respektive timpris så kan du börja logga tid direkt.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('catalog')}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Lägg till uppgift, kund & projekt
            </button>
          </div>
        )}

        {/* 3-column KPI strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <p className="text-xs font-medium text-slate-500">Timmar {periodBounds.shortPeriodName}</p>
            <p className="text-2xl sm:text-3xl font-bold text-slate-900 mt-2 font-mono tabular-nums">
              {formatHoursPlain(periodStats.totalHours)}
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <p className="text-xs font-medium text-slate-500">Intjänat {periodBounds.shortPeriodName}</p>
            <p className="text-2xl sm:text-3xl font-bold text-teal-700 mt-2 font-mono tabular-nums">
              {formatSEK(periodStats.totalEarned)}
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <p className="text-xs font-medium text-slate-500">Effektivt snittimpris</p>
            <p className="text-2xl sm:text-3xl font-bold text-slate-900 mt-2 font-mono tabular-nums">
              {Math.round(periodStats.avgRate)} kr
            </p>
          </div>
        </div>
      </div>

      {/* Calendar Grid (Week or Month, every day as a column with color-coded blocks) */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <section className="w-full bg-white border border-slate-200 rounded-xl">
          {/* Calendar Header: Week/Month Navigation + Filters */}
          <div className="px-4 sm:px-6 py-3 border-b border-slate-200 bg-slate-50/70 rounded-t-xl flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Week / Month Toggle */}
            <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-xl">
              <button
                type="button"
                onClick={() => setViewMode('week')}
                className={`px-3.5 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  viewMode === 'week'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Vecka
              </button>
              <button
                type="button"
                onClick={() => setViewMode('month')}
                className={`px-3.5 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  viewMode === 'month'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Månad
              </button>
            </div>

            {/* Period Navigation */}
            <div className="inline-flex items-center bg-white border border-slate-200 rounded-xl p-1">
              <button
                type="button"
                onClick={() => shiftPeriod(-1)}
                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
                aria-label={viewMode === 'week' ? 'Föregående vecka' : 'Föregående månad'}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setAnchorDate(todayStr)}
                className="px-2.5 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                Idag
              </button>
              <span className="px-2.5 text-xs sm:text-sm font-semibold text-slate-900 capitalize whitespace-nowrap">
                {periodBounds.label}
              </span>
              <button
                type="button"
                onClick={() => shiftPeriod(1)}
                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
                aria-label={viewMode === 'week' ? 'Nästa vecka' : 'Nästa månad'}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <span className="text-xs text-slate-500 hidden sm:inline">
              Dubbelklicka eller dra för att registrera · Dra block för att flytta
            </span>
          </div>

          {/* Calendar Multi-Select Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-40 sm:w-44">
              <MultiSelectFilter
                compact
                allLabel="Alla kunder"
                pluralUnit="kunder"
                ariaLabel="Filtrera kalender på kunder"
                options={customers.map((c) => ({ value: c.id, label: c.name }))}
                selectedValues={filterCustomerIds}
                onChange={(nextCustIds) => {
                  setFilterCustomerIds(nextCustIds);
                  if (nextCustIds.length > 0) {
                    setFilterProjectIds((prev) =>
                      prev.filter((pid) => {
                        const custId = projectsMap.get(pid)?.customerId;
                        return custId ? nextCustIds.includes(custId) : false;
                      })
                    );
                  }
                }}
              />
            </div>

            <div className="w-40 sm:w-44">
              <MultiSelectFilter
                compact
                allLabel="Alla projekt"
                pluralUnit="projekt"
                ariaLabel="Filtrera kalender på projekt"
                options={filterProjectOptions.map((p) => ({
                  value: p.id,
                  label: p.name,
                  sublabel: customersMap.get(p.customerId)?.name,
                  color: p.color,
                }))}
                selectedValues={filterProjectIds}
                onChange={setFilterProjectIds}
              />
            </div>

            <div className="w-40 sm:w-44">
              <MultiSelectFilter
                compact
                allLabel="Alla arbetsuppgifter"
                pluralUnit="uppgifter"
                ariaLabel="Filtrera kalender på arbetsuppgifter"
                options={filterTaskOptions.map((name) => ({ value: name, label: name }))}
                selectedValues={filterTaskNames}
                onChange={setFilterTaskNames}
              />
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setFilterCustomerIds([]);
                  setFilterProjectIds([]);
                  setFilterTaskNames([]);
                }}
                className="h-9 px-2.5 text-xs font-medium text-teal-700 hover:bg-teal-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                Återställ
              </button>
            )}
          </div>
        </div>

        {calendarMoveError && (
          <div className="mx-4 sm:mx-5 mt-3 px-3.5 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between gap-2">
            <span>{calendarMoveError}</span>
            <button
              type="button"
              onClick={() => setCalendarMoveError(null)}
              className="text-rose-700 font-medium hover:underline cursor-pointer"
            >
              Stäng
            </button>
          </div>
        )}

        <div
          className={`overflow-x-auto cursor-pointer ${
            dragCreatePreview || resizePreview ? 'select-none' : ''
          }`}
        >
          <div className="min-w-[880px]">
            {/* Weekday Column Headers (with left time-axis/week-axis spacer) */}
            <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-slate-200 bg-slate-50/50">
              <div className="px-2 py-2.5 border-r border-slate-200 text-[11px] font-semibold text-slate-500 flex items-center justify-center">
                {viewMode === 'week' ? 'Tid' : 'Vecka'}
              </div>

              {viewMode === 'week'
                ? calendarDays.map((day) => {
                    const dayEntries = entriesByDate.get(day.iso) || [];
                    const dayHours = dayEntries.reduce((s, e) => s + e.hours, 0);
                    const isToday = day.iso === todayStr;

                    return (
                      <div
                        key={day.iso}
                        className={`px-3 py-3 border-r last:border-r-0 border-slate-200 ${
                          isToday ? 'bg-teal-50/60' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-xs font-semibold ${
                              isToday ? 'text-teal-800' : 'text-slate-600'
                            }`}
                          >
                            {day.weekdayLabel} {day.dayNum}
                          </span>
                          {dayHours > 0 && (
                            <span className="text-xs font-mono tabular-nums font-semibold text-slate-900">
                              {formatHoursPlain(dayHours)} h
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                : WEEKDAY_SHORT.map((label) => (
                    <div
                      key={label}
                      className="px-3 py-2.5 border-r last:border-r-0 border-slate-200 text-xs font-semibold text-slate-600"
                    >
                      {label}
                    </div>
                  ))}
            </div>

            {/* Week View with Left Time Scale & Proportional Timed Blocks */}
            {viewMode === 'week' ? (
              <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] divide-x divide-slate-200">
                {/* Left Time Axis */}
                <div
                  className="relative bg-slate-50/40 select-none"
                  style={{ height: `${weekLayoutByDate.hoursRange.length * PX_PER_HOUR}px` }}
                >
                  {weekLayoutByDate.hoursRange.map((hour, idx) => (
                    <div
                      key={hour}
                      style={{ height: `${PX_PER_HOUR}px` }}
                      className={`px-1.5 pt-1 text-right text-[11px] font-mono tabular-nums text-slate-500 ${
                        idx > 0 ? 'border-t border-slate-100' : ''
                      }`}
                    >
                      {String(hour).padStart(2, '0')}:00
                    </div>
                  ))}
                </div>

                {/* 7 Day Columns */}
                {calendarDays.map((day) => {
                  const isToday = day.iso === todayStr;
                  const positioned = weekLayoutByDate.layoutMap.get(day.iso) || [];
                  const gridHeight = weekLayoutByDate.hoursRange.length * PX_PER_HOUR;

                  const computeDropSlot = (clientY: number, colRect: DOMRect) => {
                    const active = dragMoveRef.current;
                    if (!active) return null;
                    const dur = Math.min(24 * 60, Math.max(15, active.durationMin));
                    const topY = Math.max(0, clientY - colRect.top - active.grabOffsetY);
                    const rawMin = weekLayoutByDate.minHour * 60 + (topY / PX_PER_HOUR) * 60;
                    const snapped = Math.round(rawMin / 15) * 15;
                    const maxStart = Math.max(0, Math.min(23 * 60 + 45, 24 * 60 - dur));
                    const startMin = Math.max(0, Math.min(maxStart, snapped));
                    const endMin = Math.min(24 * 60, startMin + dur);
                    return { startMin, endMin };
                  };

                  return (
                    <div
                      key={day.iso}
                      data-week-day-col="true"
                      onMouseDown={(e) => handleWeekGridMouseDown(day.iso, e)}
                      onDoubleClick={(e) => handleWeekGridDoubleClick(day.iso, e)}
                      onDragOver={(e) => {
                        const active = dragMoveRef.current;
                        if (!active) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        const slot = computeDropSlot(
                          e.clientY,
                          e.currentTarget.getBoundingClientRect()
                        );
                        if (!slot) return;
                        setWeekDropPreview((prev) => {
                          if (
                            prev &&
                            prev.date === day.iso &&
                            prev.startMin === slot.startMin &&
                            prev.endMin === slot.endMin
                          ) {
                            return prev;
                          }
                          return {
                            date: day.iso,
                            startMin: slot.startMin,
                            endMin: slot.endMin,
                            color: active.color,
                            title: active.title,
                          };
                        });
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                          setWeekDropPreview((prev) => (prev?.date === day.iso ? null : prev));
                        }
                      }}
                      onDrop={(e) => {
                        const active = dragMoveRef.current;
                        if (!active) return;
                        e.preventDefault();
                        const slot = computeDropSlot(
                          e.clientY,
                          e.currentTarget.getBoundingClientRect()
                        );
                        dragMoveRef.current = null;
                        setDraggingEntryId(null);
                        setWeekDropPreview(null);
                        if (!slot) return;
                        void handleMoveEntry(
                          active.entry,
                          day.iso,
                          formatMinutesToTime(slot.startMin),
                          formatEndMinutesToTime(slot.endMin)
                        );
                      }}
                      style={{ height: `${gridHeight}px` }}
                      className={`relative cursor-pointer ${
                        isToday ? 'bg-teal-50/20' : 'bg-white'
                      }`}
                    >
                      {/* Hour grid lines with quarter-hour hover slots */}
                      {weekLayoutByDate.hoursRange.map((hour, idx) => (
                        <div
                          key={hour}
                          style={{ height: `${PX_PER_HOUR}px` }}
                          className={`flex flex-col ${idx > 0 ? 'border-t border-slate-100' : ''}`}
                        >
                          {[0, 15, 30, 45].map((minute) => {
                            const slotLabel = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                            const isInteracting = Boolean(
                              dragCreatePreview || weekDropPreview || resizePreview
                            );
                            return (
                              <div
                                key={minute}
                                style={{ height: `${PX_PER_HOUR / 4}px` }}
                                className={`group/slot px-1.5 flex items-center transition-colors ${
                                  isInteracting
                                    ? ''
                                    : 'hover:bg-teal-500/10 hover:ring-1 hover:ring-inset hover:ring-teal-500/25'
                                }`}
                              >
                                {!isInteracting && (
                                  <span className="text-[10px] leading-none font-mono tabular-nums font-medium text-teal-800/80 opacity-0 group-hover/slot:opacity-100 transition-opacity pointer-events-none select-none">
                                    {slotLabel}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}

                      {/* Yellow current-time indicator line across today's column only */}
                      {isToday &&
                        nowMinutes >= weekLayoutByDate.minHour * 60 &&
                        nowMinutes <= weekLayoutByDate.maxHour * 60 && (
                          <div
                            style={{
                              top: `${((nowMinutes - weekLayoutByDate.minHour * 60) / 60) * PX_PER_HOUR}px`,
                            }}
                            className="absolute left-0 right-0 z-20 h-0.5 bg-yellow-400 pointer-events-none"
                            aria-label={`Aktuell tid ${formatMinutesToTime(nowMinutes)}`}
                          />
                        )}

                      {/* Live preview while click-and-dragging to create a new registration */}
                      {dragCreatePreview && dragCreatePreview.date === day.iso && (
                        <div
                          style={{
                            top: `${Math.max(0, ((dragCreatePreview.startMin - weekLayoutByDate.minHour * 60) / 60) * PX_PER_HOUR) + 1}px`,
                            height: `${Math.max(18, Math.round(((dragCreatePreview.endMin - dragCreatePreview.startMin) / 60) * PX_PER_HOUR) - 2)}px`,
                          }}
                          className="absolute left-1 right-1 z-30 rounded-lg border-2 border-dashed border-teal-600 bg-teal-500/15 px-2 py-1 pointer-events-none flex flex-col justify-between overflow-hidden"
                        >
                          <span className="text-[11px] font-semibold text-teal-900 truncate">
                            Ny registrering
                          </span>
                          <span className="text-[11px] font-mono tabular-nums font-semibold text-teal-800 truncate">
                            {formatMinutesToTime(dragCreatePreview.startMin)}–
                            {formatEndMinutesToTime(dragCreatePreview.endMin)} ·{' '}
                            {formatHoursPlain((dragCreatePreview.endMin - dragCreatePreview.startMin) / 60)} h
                          </span>
                        </div>
                      )}

                      {/* Live preview while dragging an existing entry to a new day/time */}
                      {weekDropPreview && weekDropPreview.date === day.iso && (
                        <div
                          style={{
                            top: `${Math.max(0, ((weekDropPreview.startMin - weekLayoutByDate.minHour * 60) / 60) * PX_PER_HOUR) + 1}px`,
                            height: `${Math.max(22, Math.round(((weekDropPreview.endMin - weekDropPreview.startMin) / 60) * PX_PER_HOUR) - 2)}px`,
                            backgroundColor: hexToRgba(weekDropPreview.color, 0.22),
                            borderColor: weekDropPreview.color,
                          }}
                          className="absolute left-1 right-1 z-30 rounded-lg border-2 border-dashed px-2 py-1 pointer-events-none flex flex-col justify-between overflow-hidden"
                        >
                          <span className="text-[11px] font-semibold text-slate-900 truncate">
                            {weekDropPreview.title}
                          </span>
                          <span className="text-[11px] font-mono tabular-nums font-semibold text-slate-800 truncate">
                            {formatMinutesToTime(weekDropPreview.startMin)}–
                            {formatEndMinutesToTime(weekDropPreview.endMin)}
                          </span>
                        </div>
                      )}

                      {/* Proportional Color-coded Time Entry Boxes */}
                      {positioned.map(({ entry, startMin, endMin, colIndex, colCount }) => {
                        const proj = projectsMap.get(entry.projectId);
                        const color = proj?.color || '#0F766E';
                        const isResizing = resizePreview?.entryId === entry.id;
                        const effectiveStartMin = isResizing ? resizePreview.startMin : startMin;
                        const effectiveEndMin = isResizing ? resizePreview.endMin : endMin;
                        const effectiveHours = isResizing
                          ? Math.min(
                              24,
                              Math.max(
                                0.25,
                                Math.round(((effectiveEndMin - effectiveStartMin) / 60) * 4) / 4
                              )
                            )
                          : entry.hours;

                        const topPx = Math.max(
                          0,
                          ((effectiveStartMin - weekLayoutByDate.minHour * 60) / 60) * PX_PER_HOUR
                        );
                        const pxHeight = Math.max(
                          24,
                          Math.round(((effectiveEndMin - effectiveStartMin) / 60) * PX_PER_HOUR) - 2
                        );
                        const isCompact = pxHeight < 40;

                        const widthPct = 100 / colCount;
                        const leftPct = colIndex * widthPct;
                        const showTooltipBelow =
                          effectiveStartMin < (weekLayoutByDate.minHour + 1) * 60;
                        const dayIndex = calendarDays.findIndex((d) => d.iso === day.iso);
                        const alignTooltipRight = dayIndex >= 5;

                        return (
                          <div
                            key={entry.id}
                            style={{
                              top: `${topPx + 1}px`,
                              height: `${pxHeight}px`,
                              left: `calc(${leftPct}% + 2px)`,
                              width: `calc(${widthPct}% - 4px)`,
                            }}
                            className={`absolute group hover:z-40 ${
                              isResizing ? 'z-30' : 'z-10'
                            } ${draggingEntryId === entry.id ? 'opacity-40' : ''}`}
                          >
                            <button
                              type="button"
                              draggable={!entry.invoiced}
                              onMouseDown={(e) => e.stopPropagation()}
                              onDragStart={(e) => {
                                if (entry.invoiced) {
                                  e.preventDefault();
                                  return;
                                }
                                const rect = e.currentTarget.getBoundingClientRect();
                                dragMoveRef.current = {
                                  entry,
                                  grabOffsetY: e.clientY - rect.top,
                                  durationMin: Math.max(15, Math.round(entry.hours * 60)),
                                  color,
                                  title: proj?.name || 'Projekt',
                                };
                                setDraggingEntryId(entry.id);
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', entry.id);
                              }}
                              onDragEnd={() => {
                                dragMoveRef.current = null;
                                setDraggingEntryId(null);
                                setWeekDropPreview(null);
                                setMonthDropDate(null);
                              }}
                              onClick={() => setEditingEntry(entry)}
                              onDoubleClick={(e) => e.stopPropagation()}
                              style={{
                                backgroundColor: hexToRgba(color, isResizing ? 0.22 : 0.14),
                                borderColor: isResizing ? color : hexToRgba(color, 0.5),
                              }}
                              className={`w-full h-full text-left rounded-lg border transition-opacity hover:opacity-90 cursor-pointer overflow-hidden flex flex-col justify-start ${
                                isCompact ? 'px-2 py-0.5' : 'p-2'
                              }`}
                            >
                              <div className="min-w-0 w-full">
                                <div className="flex items-center justify-between gap-1.5">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span
                                      className="w-2 h-2 rounded-xs shrink-0"
                                      style={{ backgroundColor: color }}
                                      aria-hidden="true"
                                    />
                                    <span className="text-[11px] sm:text-xs font-semibold text-slate-900 truncate">
                                      {proj?.name || 'Projekt'}
                                    </span>
                                    {isCompact && (
                                      <span className="text-[11px] text-slate-700 truncate">
                                        · {entry.taskName}
                                      </span>
                                    )}
                                  </div>
                                  {entry.invoiced && (
                                    <Lock
                                      className="w-3 h-3 text-slate-500 shrink-0"
                                      aria-label="Fakturerad"
                                    />
                                  )}
                                </div>

                                {!isCompact && (
                                  <p className="text-[11px] text-slate-700 truncate mt-0.5">
                                    {entry.taskName}
                                  </p>
                                )}

                                {pxHeight >= 118 && entry.description && (
                                  <p className="text-[11px] text-slate-600 line-clamp-2 mt-1">
                                    {entry.description}
                                  </p>
                                )}
                              </div>
                            </button>

                            {!draggingEntryId && (
                              <div
                                className={`pointer-events-none transition-opacity absolute ${
                                  alignTooltipRight ? 'right-0' : 'left-0'
                                } ${
                                  showTooltipBelow ? 'top-full mt-1' : 'bottom-full mb-1'
                                } z-50 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white shadow-lg whitespace-nowrap ${
                                  isResizing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                }`}
                              >
                                {isCompact && (
                                  <p className="text-[11px] font-semibold leading-tight mb-0.5">
                                    {entry.taskName}
                                  </p>
                                )}
                                <p className="text-[11px] font-mono tabular-nums text-teal-200 leading-tight">
                                  {formatHoursPlain(effectiveHours)} tim
                                  {isResizing
                                    ? ` (${formatMinutesToTime(effectiveStartMin)}–${formatEndMinutesToTime(effectiveEndMin)})`
                                    : ''}
                                </p>
                              </div>
                            )}

                            {!entry.invoiced && !draggingEntryId && !isResizing && (
                              <button
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()}
                                onDoubleClick={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteError(null);
                                  setDeletingEntry(entry);
                                }}
                                aria-label="Ta bort registrering"
                                className={`opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity absolute z-20 rounded-md bg-white/95 hover:bg-red-50 text-slate-500 hover:text-red-600 border border-slate-200/80 shadow-xs cursor-pointer flex items-center justify-center ${
                                  isCompact ? 'bottom-0.5 right-1 p-0.5' : 'bottom-1.5 right-1.5 p-1'
                                }`}
                              >
                                <Trash2 className={isCompact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
                              </button>
                            )}

                            {!entry.invoiced && (
                              <>
                                <div
                                  role="separator"
                                  aria-orientation="horizontal"
                                  aria-label="Dra övre kanten för att ändra starttid"
                                  onMouseDown={(e) =>
                                    handleResizeMouseDown(
                                      entry,
                                      'top',
                                      effectiveStartMin,
                                      effectiveEndMin,
                                      e
                                    )
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  onDoubleClick={(e) => e.stopPropagation()}
                                  className={`absolute top-0 left-1 right-1 ${
                                    isCompact ? 'h-1.5' : 'h-2'
                                  } cursor-ns-resize flex items-start justify-center pt-0.5`}
                                >
                                  <span
                                    className={`w-6 h-0.5 rounded-full bg-slate-500/70 transition-opacity ${
                                      isResizing
                                        ? 'opacity-100'
                                        : 'opacity-0 group-hover:opacity-100'
                                    }`}
                                  />
                                </div>

                                <div
                                  role="separator"
                                  aria-orientation="horizontal"
                                  aria-label="Dra nedre kanten för att ändra sluttid"
                                  onMouseDown={(e) =>
                                    handleResizeMouseDown(
                                      entry,
                                      'bottom',
                                      effectiveStartMin,
                                      effectiveEndMin,
                                      e
                                    )
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  onDoubleClick={(e) => e.stopPropagation()}
                                  className={`absolute bottom-0 left-1 right-1 ${
                                    isCompact ? 'h-1.5' : 'h-2'
                                  } cursor-ns-resize flex items-end justify-center pb-0.5`}
                                >
                                  <span
                                    className={`w-6 h-0.5 rounded-full bg-slate-500/70 transition-opacity ${
                                      isResizing
                                        ? 'opacity-100'
                                        : 'opacity-0 group-hover:opacity-100'
                                    }`}
                                  />
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Month View with Left Week Number Indicator & Double-click to Log */
              <div className="divide-y divide-slate-200">
                {monthWeeks.map((week, weekIdx) => (
                  <div
                    key={`week-${week.weekNum}-${week.days[0]?.iso}`}
                    className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] divide-x divide-slate-200"
                  >
                    <div className="bg-slate-50/40 px-1.5 py-2.5 text-center text-[11px] font-mono tabular-nums font-semibold text-slate-500 flex items-start justify-center">
                      v.{week.weekNum}
                    </div>

                    {week.days.map((day, dayIdx) => {
                      const dayEntries = entriesByDate.get(day.iso) || [];
                      const dayHours = dayEntries.reduce((s, e) => s + e.hours, 0);
                      const isToday = day.iso === todayStr;
                      const isDropTarget = monthDropDate === day.iso;

                      return (
                        <div
                          key={day.iso}
                          onDoubleClick={() => setCreateModalState({ date: day.iso })}
                          onDragOver={(e) => {
                            if (!dragMoveRef.current) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            if (monthDropDate !== day.iso) {
                              setMonthDropDate(day.iso);
                            }
                          }}
                          onDragLeave={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                              setMonthDropDate((prev) => (prev === day.iso ? null : prev));
                            }
                          }}
                          onDrop={(e) => {
                            const active = dragMoveRef.current;
                            if (!active) return;
                            e.preventDefault();
                            dragMoveRef.current = null;
                            setDraggingEntryId(null);
                            setMonthDropDate(null);
                            void handleMoveEntry(
                              active.entry,
                              day.iso,
                              active.entry.startTime,
                              active.entry.endTime
                            );
                          }}
                          className={`flex flex-col min-h-[140px] cursor-pointer transition-colors ${
                            isDropTarget
                              ? 'bg-teal-50/70 ring-2 ring-inset ring-teal-500'
                              : !day.inCurrentMonth
                                ? 'bg-slate-50/70'
                                : isToday
                                  ? 'bg-teal-50/25'
                                  : 'bg-white'
                          }`}
                        >
                          <div className="px-2.5 pt-2 pb-1.5 flex items-center justify-between gap-1">
                            <span
                              className={`text-xs font-semibold font-mono tabular-nums w-6 h-6 flex items-center justify-center rounded-md ${
                                isToday
                                  ? 'bg-teal-700 text-white'
                                  : day.inCurrentMonth
                                    ? 'text-slate-900'
                                    : 'text-slate-400'
                              }`}
                            >
                              {day.dayNum}
                            </span>
                            {dayHours > 0 && (
                              <span className="text-[11px] font-mono tabular-nums font-medium text-slate-600">
                                {formatHoursPlain(dayHours)}h
                              </span>
                            )}
                          </div>

                          <div className="p-2 space-y-1.5 flex-1">
                            {dayEntries.map((entry) => {
                              const proj = projectsMap.get(entry.projectId);
                              const color = proj?.color || '#0F766E';
                              const pxHeight = Math.max(22, Math.round(entry.hours * 16));
                              const isCompact = pxHeight < 38;

                              return (
                                <div key={entry.id} className="relative group hover:z-40">
                                  <button
                                    type="button"
                                    draggable={!entry.invoiced}
                                    onDragStart={(e) => {
                                      if (entry.invoiced) {
                                        e.preventDefault();
                                        return;
                                      }
                                      dragMoveRef.current = {
                                        entry,
                                        grabOffsetY: 0,
                                        durationMin: Math.max(15, Math.round(entry.hours * 60)),
                                        color,
                                        title: proj?.name || 'Projekt',
                                      };
                                      setDraggingEntryId(entry.id);
                                      e.dataTransfer.effectAllowed = 'move';
                                      e.dataTransfer.setData('text/plain', entry.id);
                                    }}
                                    onDragEnd={() => {
                                      dragMoveRef.current = null;
                                      setDraggingEntryId(null);
                                      setWeekDropPreview(null);
                                      setMonthDropDate(null);
                                    }}
                                    onClick={() => setEditingEntry(entry)}
                                    onDoubleClick={(e) => e.stopPropagation()}
                                    style={{
                                      height: `${pxHeight}px`,
                                      backgroundColor: hexToRgba(color, 0.14),
                                      borderColor: hexToRgba(color, 0.5),
                                    }}
                                    className={`w-full text-left rounded-lg border transition-opacity hover:opacity-90 cursor-pointer overflow-hidden flex flex-col justify-start ${
                                      isCompact ? 'px-2 py-1' : 'p-2'
                                    } ${draggingEntryId === entry.id ? 'opacity-40' : ''}`}
                                  >
                                    <div className="min-w-0 w-full">
                                      <div className="flex items-center justify-between gap-1.5">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          <span
                                            className="w-2 h-2 rounded-xs shrink-0"
                                            style={{ backgroundColor: color }}
                                            aria-hidden="true"
                                          />
                                          <span className="text-[11px] sm:text-xs font-semibold text-slate-900 truncate">
                                            {proj?.name || 'Projekt'}
                                          </span>
                                          {isCompact && (
                                            <span className="text-[11px] text-slate-700 truncate">
                                              · {entry.taskName}
                                            </span>
                                          )}
                                        </div>
                                        {entry.invoiced && (
                                          <Lock
                                            className="w-3 h-3 text-slate-500 shrink-0"
                                            aria-label="Fakturerad"
                                          />
                                        )}
                                      </div>

                                      {!isCompact && (
                                        <p className="text-[11px] text-slate-700 truncate mt-0.5">
                                          {entry.taskName}
                                        </p>
                                      )}
                                    </div>
                                  </button>

                                  {!entry.invoiced && !draggingEntryId && (
                                    <button
                                      type="button"
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onDoubleClick={(e) => e.stopPropagation()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDeleteError(null);
                                        setDeletingEntry(entry);
                                      }}
                                      aria-label="Ta bort registrering"
                                      className={`opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity absolute z-20 rounded-md bg-white/95 hover:bg-red-50 text-slate-500 hover:text-red-600 border border-slate-200/80 shadow-xs cursor-pointer flex items-center justify-center ${
                                        isCompact ? 'bottom-0.5 right-1 p-0.5' : 'bottom-1 right-1 p-1'
                                      }`}
                                    >
                                      <Trash2 className={isCompact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
                                    </button>
                                  )}

                                  {!draggingEntryId && (
                                    <div
                                      className={`pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity absolute ${
                                        dayIdx >= 5 ? 'right-0' : 'left-0'
                                      } ${
                                        weekIdx === 0 ? 'top-full mt-1' : 'bottom-full mb-1'
                                      } z-50 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white shadow-lg whitespace-nowrap`}
                                    >
                                      {isCompact && (
                                        <p className="text-[11px] font-semibold leading-tight mb-0.5">
                                          {entry.taskName}
                                        </p>
                                      )}
                                      <p className="text-[11px] font-mono tabular-nums text-teal-200 leading-tight">
                                        {formatHoursPlain(entry.hours)} tim
                                      </p>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </section>
      </div>

      {/* Period Breakdown per Kund / Projekt / Uppgift */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Upparbetad tid & intäkt
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 capitalize">{periodBounds.label}</p>
          </div>

          <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg self-start">
            {(
              [
                { id: 'project', label: 'Per projekt' },
                { id: 'customer', label: 'Per kund' },
                { id: 'task', label: 'Per uppgift' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setBreakdownMode(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  breakdownMode === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {breakdownRows.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-slate-600 mb-4">
              Ingen tid registrerad för {periodBounds.label}.
            </p>
            <button
              type="button"
              onClick={() => setCreateModalState({ date: todayStr })}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Logga arbetad tid
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {breakdownRows.map((row) => {
              const pct = Math.max(4, Math.round((row.earned / maxEarned) * 100));
              const avg = row.billableHours > 0 ? row.earned / row.billableHours : 0;
              return (
                <div key={row.key} className="px-5 py-4 hover:bg-slate-50/70 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-2.5 h-2.5 rounded-xs shrink-0"
                          style={{ backgroundColor: row.color }}
                          aria-hidden="true"
                        />
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {row.name}
                        </p>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 pl-5">
                        {row.subtitle} · {row.entriesCount} {row.entriesCount === 1 ? 'post' : 'poster'} · {Math.round(avg)} kr/tim snitt
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-slate-900 font-mono tabular-nums">
                        {formatSEK(row.earned)}
                      </p>
                      <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                        {formatHours(row.hours)}
                        {row.invoicedEarned > 0 && ` · Fakt. ${formatSEK(row.invoicedEarned)}`}
                      </p>
                    </div>
                  </div>

                  <div className="mt-2.5 pl-5">
                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: row.color,
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </section>
      </div>

      <EntryEditModal
        entry={editingEntry}
        customers={customers}
        projects={projects}
        taskTypes={taskTypes}
        onClose={() => setEditingEntry(null)}
      />

      <EntryCreateModal
        isOpen={Boolean(createModalState)}
        uid={uid}
        initialDate={createModalState?.date || todayStr}
        initialStartTime={createModalState?.startTime}
        initialEndTime={createModalState?.endTime}
        customers={customers}
        projects={projects}
        taskTypes={taskTypes}
        defaultCustomerId={filterCustomerIds[0]}
        defaultProjectId={filterProjectIds[0]}
        defaultTaskName={filterTaskNames[0]}
        onClose={() => setCreateModalState(null)}
      />

      {deletingEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="bg-white w-full max-w-md rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">
              Bekräfta borttagning
            </h3>
            <p className="text-sm text-slate-600">
              Vill du ta bort tidregistreringen för{' '}
              <span className="font-medium text-slate-900">
                {projectsMap.get(deletingEntry.projectId)?.name || 'Projekt'}
              </span>{' '}
              ({deletingEntry.date}, {formatHoursAndMinutes(deletingEntry.hours)} ·{' '}
              {deletingEntry.taskName})? Åtgärden kan inte ångras.
            </p>
            {deleteError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                {deleteError}
              </div>
            )}
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => {
                  setDeletingEntry(null);
                  setDeleteError(null);
                }}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Avbryt
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={async () => {
                  setDeleteBusy(true);
                  setDeleteError(null);
                  try {
                    await deleteTimeEntry(deletingEntry.id);
                    setDeletingEntry(null);
                  } catch (err) {
                    setDeleteError(
                      err instanceof Error
                        ? err.message
                        : 'Kunde inte ta bort tidsregistreringen.'
                    );
                  } finally {
                    setDeleteBusy(false);
                  }
                }}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer disabled:opacity-60"
              >
                {deleteBusy ? 'Raderar...' : 'Radera'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
