import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Customer, Project, TaskType } from '../types/timeTracking';
import {
  createTimeEntry,
  resolveHourlyRate,
  resolveProjectRate,
  resolveTaskOverrideRate,
} from '../lib/firestoreService';
import {
  calculateHoursFromTimes,
  formatHoursAndMinutes,
  formatSEK,
  formatSwedishDateFull,
  QUARTER_HOUR_END_TIMES,
  QUARTER_HOUR_TIMES,
} from '../lib/formatters';
import { QuarterTimeSelect } from './QuarterTimeSelect';

interface EntryCreateModalProps {
  isOpen: boolean;
  uid: string;
  initialDate: string;
  initialStartTime?: string;
  initialEndTime?: string;
  customers: Customer[];
  projects: Project[];
  taskTypes: TaskType[];
  defaultCustomerId?: string;
  defaultProjectId?: string;
  defaultTaskName?: string;
  onClose: () => void;
  onSaved?: () => void;
}

export function EntryCreateModal({
  isOpen,
  uid,
  initialDate,
  initialStartTime = '',
  initialEndTime = '',
  customers,
  projects,
  taskTypes,
  defaultCustomerId,
  defaultProjectId,
  defaultTaskName,
  onClose,
  onSaved,
}: EntryCreateModalProps) {
  const activeCustomers = useMemo(() => customers.filter((c) => !c.archived), [customers]);
  const activeProjects = useMemo(() => projects.filter((p) => p.status === 'active'), [projects]);

  const [customerId, setCustomerId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [taskTypeId, setTaskTypeId] = useState('');
  const [date, setDate] = useState(initialDate);
  const [startTime, setStartTime] = useState(initialStartTime);
  const [endTime, setEndTime] = useState(initialEndTime);
  const [durationHours, setDurationHours] = useState(1);
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [hourlyRate, setHourlyRate] = useState('0');
  const [billable, setBillable] = useState(true);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let chosenProj =
      (defaultProjectId &&
        defaultProjectId !== 'all' &&
        activeProjects.find((p) => p.id === defaultProjectId)) ||
      undefined;

    if (!chosenProj && defaultCustomerId && defaultCustomerId !== 'all') {
      chosenProj = activeProjects.find((p) => p.customerId === defaultCustomerId);
    }

    if (!chosenProj) {
      chosenProj = activeProjects[0];
    }

    const nextProjectId = chosenProj?.id || '';
    const nextCustomerId =
      chosenProj?.customerId ||
      (defaultCustomerId && defaultCustomerId !== 'all' ? defaultCustomerId : activeCustomers[0]?.id || '');

    const matchingTasks = taskTypes.filter(
      (t) => !t.archived && (t.projectId === '' || t.projectId === nextProjectId)
    );
    const chosenTask =
      (defaultTaskName &&
        defaultTaskName !== 'all' &&
        matchingTasks.find((t) => t.name === defaultTaskName)) ||
      matchingTasks[0];

    setCustomerId(nextCustomerId);
    setProjectId(nextProjectId);
    setTaskTypeId(chosenTask?.id || '');
    setHourlyRate(String(resolveHourlyRate(chosenProj, chosenTask, initialDate)));
    setDate(initialDate);
    setStartTime(initialStartTime);
    setEndTime(initialEndTime);

    const calc =
      initialStartTime && initialEndTime
        ? calculateHoursFromTimes(initialStartTime, initialEndTime)
        : null;
    const initialTotalMin = Math.max(
      15,
      Math.min(24 * 60, Math.round(((calc ?? 1) * 60) / 15) * 15)
    );
    setDurationHours(Math.floor(initialTotalMin / 60));
    setDurationMinutes(initialTotalMin % 60);
    setBillable(true);
    setDescription('');
    setError(null);
  }, [
    isOpen,
    initialDate,
    initialStartTime,
    initialEndTime,
    defaultCustomerId,
    defaultProjectId,
    defaultTaskName,
    activeCustomers,
    activeProjects,
    taskTypes,
  ]);

  if (!isOpen) return null;

  const availableProjects = activeProjects.filter((p) => p.customerId === customerId);
  const availableTasks = taskTypes.filter(
    (t) => !t.archived && (t.projectId === '' || t.projectId === projectId)
  );
  const selectedProject = activeProjects.find((p) => p.id === projectId) || null;

  const handleCustomerChange = (newCustomerId: string) => {
    setCustomerId(newCustomerId);
    const matching = activeProjects.filter((p) => p.customerId === newCustomerId);
    const firstProj = matching[0] || null;
    const nextProjId = firstProj?.id || '';
    setProjectId(nextProjId);

    const nextTasks = taskTypes.filter(
      (t) => !t.archived && (t.projectId === '' || t.projectId === nextProjId)
    );
    let activeTask = nextTasks.find((t) => t.id === taskTypeId) || null;
    if (!activeTask) {
      activeTask = nextTasks[0] || null;
      setTaskTypeId(activeTask?.id || '');
    }
    setHourlyRate(String(resolveHourlyRate(firstProj, activeTask, date)));
  };

  const handleProjectChange = (newProjectId: string) => {
    setProjectId(newProjectId);
    const proj = activeProjects.find((p) => p.id === newProjectId) || null;
    if (proj && proj.customerId !== customerId) {
      setCustomerId(proj.customerId);
    }
    const nextTasks = taskTypes.filter(
      (t) => !t.archived && (t.projectId === '' || t.projectId === newProjectId)
    );
    let activeTask = nextTasks.find((t) => t.id === taskTypeId) || null;
    if (!activeTask) {
      activeTask = nextTasks[0] || null;
      setTaskTypeId(activeTask?.id || '');
    }
    setHourlyRate(String(resolveHourlyRate(proj, activeTask, date)));
  };

  const handleTaskChange = (newTaskId: string) => {
    setTaskTypeId(newTaskId);
    const task = taskTypes.find((t) => t.id === newTaskId) || null;
    setHourlyRate(String(resolveHourlyRate(selectedProject, task, date)));
  };

  const handleDateChange = (nextDate: string) => {
    setDate(nextDate);
    const task = taskTypes.find((t) => t.id === taskTypeId) || null;
    setHourlyRate(String(resolveHourlyRate(selectedProject, task, nextDate)));
  };

  const handleTimeRangeChange = (nextStart: string, nextEnd: string) => {
    setStartTime(nextStart);
    setEndTime(nextEnd);
    const calc = calculateHoursFromTimes(nextStart, nextEnd);
    if (calc !== null && calc >= 0.25 && calc <= 24) {
      const totalMin = Math.max(15, Math.min(24 * 60, Math.round((calc * 60) / 15) * 15));
      setDurationHours(Math.floor(totalMin / 60));
      setDurationMinutes(totalMin % 60);
    }
  };

  const handleDurationChange = (nextHours: number, nextMinutes: number) => {
    const clampedH = Math.max(0, Math.min(24, nextHours));
    let clampedM = clampedH === 24 ? 0 : nextMinutes;
    if (clampedH === 0 && clampedM === 0) {
      clampedM = 15;
    }
    setDurationHours(clampedH);
    setDurationMinutes(clampedM);

    const totalMin = clampedH * 60 + clampedM;
    if (startTime && /^\d{2}:\d{2}$/.test(startTime)) {
      const [sh, sm] = startTime.split(':').map(Number);
      const nextEndMin = sh * 60 + sm + totalMin;
      if (nextEndMin <= 24 * 60) {
        const eh = Math.floor(nextEndMin / 60);
        const em = nextEndMin % 60;
        setEndTime(
          eh === 24
            ? '24:00'
            : `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`
        );
      } else {
        setEndTime('');
      }
    }
  };

  const parsedHours = durationHours + durationMinutes / 60;
  const parsedRate = Number(hourlyRate.replace(',', '.')) || 0;
  const previewTotal = billable ? parsedHours * parsedRate : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!customerId || !projectId) {
      setError('Välj kund och projekt.');
      return;
    }
    if (parsedHours < 0.25 || parsedHours > 24) {
      setError('Minsta bokningsbara enhet är 15 min, upp till 24 tim.');
      return;
    }

    setSaving(true);
    try {
      const selectedTask = taskTypes.find((t) => t.id === taskTypeId);
      await createTimeEntry(uid, {
        customerId,
        projectId,
        taskTypeId,
        taskName: selectedTask ? selectedTask.name : 'Allmänt arbete',
        date,
        startTime,
        endTime,
        hours: Math.min(24, Math.max(0.25, Math.round(parsedHours * 4) / 4)),
        hourlyRate: parsedRate,
        billable,
        description,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte spara tidrapport.');
    } finally {
      setSaving(false);
    }
  };

  const missingProjects = activeCustomers.length === 0 || activeProjects.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/45 backdrop-blur-xs p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl border border-slate-200 max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Registrera arbetad tid</h2>
            <p className="text-xs text-slate-500 mt-0.5 capitalize">
              {formatSwedishDateFull(date)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Stäng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {missingProjects ? (
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-600">
              Du behöver minst en aktiv kund och ett aktivt projekt innan du kan registrera tid i kalendern.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Stäng
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Kund</label>
                <select
                  value={customerId}
                  onChange={(e) => handleCustomerChange(e.target.value)}
                  className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
                >
                  {activeCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Projekt</label>
                <select
                  value={projectId}
                  onChange={(e) => handleProjectChange(e.target.value)}
                  className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
                >
                  {availableProjects.length === 0 ? (
                    <option value="">Inga aktiva projekt</option>
                  ) : (
                    availableProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({resolveProjectRate(p, date)} kr/tim)
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Arbetsuppgift
                </label>
                <select
                  value={taskTypeId}
                  onChange={(e) => handleTaskChange(e.target.value)}
                  className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
                >
                  <option value="">
                    Allmänt arbete (Projektpris: {resolveProjectRate(selectedProject, date)} kr/tim)
                  </option>
                  {availableTasks.map((t) => {
                    const overrideRate = resolveTaskOverrideRate(t, date);
                    return (
                      <option key={t.id} value={t.id}>
                        {t.name} (
                        {overrideRate !== null
                          ? `${overrideRate} kr/tim`
                          : `Projektpris: ${resolveProjectRate(selectedProject, date)} kr/tim`}
                        )
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Datum</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => handleDateChange(e.target.value)}
                  required
                  className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 font-mono tabular-nums"
                />
              </div>
            </div>

              <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1.45fr] gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Starttid</label>
                  <QuarterTimeSelect
                    value={startTime}
                    options={QUARTER_HOUR_TIMES}
                    onChange={(nextStart) => handleTimeRangeChange(nextStart, endTime)}
                    ariaLabel="Starttid"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Sluttid</label>
                  <QuarterTimeSelect
                    value={endTime}
                    options={QUARTER_HOUR_END_TIMES}
                    onChange={(nextEnd) => handleTimeRangeChange(startTime, nextEnd)}
                    ariaLabel="Sluttid"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">
                    Tid (tim &amp; min)
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <select
                      value={durationHours}
                      onChange={(e) => handleDurationChange(Number(e.target.value), durationMinutes)}
                      aria-label="Timmar"
                      className="w-full h-11 px-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 font-mono tabular-nums"
                    >
                      {Array.from({ length: 25 }, (_, h) => (
                        <option key={h} value={h}>
                          {h} tim
                        </option>
                      ))}
                    </select>
                    <select
                      value={durationMinutes}
                      disabled={durationHours === 24}
                      onChange={(e) => handleDurationChange(durationHours, Number(e.target.value))}
                      aria-label="Minuter"
                      className="w-full h-11 px-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 font-mono tabular-nums disabled:bg-slate-100"
                    >
                      {[0, 15, 30, 45].map((m) => (
                        <option key={m} value={m} disabled={durationHours === 0 && m === 0}>
                          {String(m).padStart(2, '0')} min
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Timpris (kr/tim)
                </label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="100000"
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(e.target.value)}
                  className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 font-mono tabular-nums"
                />
              </div>

              <label className="h-11 px-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between cursor-pointer">
                <span className="text-sm font-medium text-slate-700">Debiterbar tid</span>
                <input
                  type="checkbox"
                  checked={billable}
                  onChange={(e) => setBillable(e.target.checked)}
                  className="w-4 h-4 accent-teal-700"
                />
              </label>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Beskrivning</label>
              <textarea
                rows={2}
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Vad utfördes under arbetspasset?"
                className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
              />
            </div>

            <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-sm text-slate-600">
                {formatHoursAndMinutes(parsedHours)} · Beräknat belopp
              </span>
              <span className="text-base font-semibold text-slate-900 font-mono tabular-nums">
                {formatSEK(previewTotal)}
              </span>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Avbryt
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
              >
                {saving ? 'Sparar...' : 'Spara tidrapport'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
