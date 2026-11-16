import React, { useEffect, useState } from 'react';
import { Lock, Receipt, RotateCcw, Trash2, X } from 'lucide-react';
import { Customer, Project, TaskType, TimeEntry } from '../types/timeTracking';
import {
  deleteTimeEntry,
  markTimeEntriesInvoiced,
  resolveHourlyRate,
  resolveProjectRate,
  resolveTaskOverrideRate,
  unmarkTimeEntriesInvoiced,
  updateTimeEntry,
} from '../lib/firestoreService';
import {
  calculateHoursFromTimes,
  formatHoursAndMinutes,
  formatSEK,
  QUARTER_HOUR_END_TIMES,
  QUARTER_HOUR_TIMES,
  todayIsoDate,
} from '../lib/formatters';
import { QuarterTimeSelect } from './QuarterTimeSelect';

interface EntryEditModalProps {
  entry: TimeEntry | null;
  customers: Customer[];
  projects: Project[];
  taskTypes: TaskType[];
  onClose: () => void;
  onSaved?: () => void;
}

export function EntryEditModal({
  entry,
  customers,
  projects,
  taskTypes,
  onClose,
  onSaved,
}: EntryEditModalProps) {
  const [customerId, setCustomerId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [taskTypeId, setTaskTypeId] = useState('');
  const [customTaskName, setCustomTaskName] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [durationHours, setDurationHours] = useState(1);
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [hourlyRate, setHourlyRate] = useState('0');
  const [billable, setBillable] = useState(true);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmInvoiceMode, setConfirmInvoiceMode] = useState<'invoice' | 'undo' | null>(null);
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (!entry) return;
    setCustomerId(entry.customerId);
    setProjectId(entry.projectId);
    setTaskTypeId(entry.taskTypeId);
    setCustomTaskName(entry.taskName);
    setDate(entry.date);
    setStartTime(entry.startTime || '');
    setEndTime(entry.endTime || '');
    const snappedTotalMin = Math.max(
      15,
      Math.min(24 * 60, Math.round((entry.hours * 60) / 15) * 15)
    );
    setDurationHours(Math.floor(snappedTotalMin / 60));
    setDurationMinutes(snappedTotalMin % 60);
    setHourlyRate(String(entry.hourlyRate));
    setBillable(entry.billable);
    setDescription(entry.description || '');
    setError(null);
    setConfirmInvoiceMode(null);
    setConfirmDeleteOpen(false);
  }, [entry]);

  if (!entry) return null;

  const isLocked = entry.invoiced;
  const availableProjects = projects.filter((p) => p.customerId === customerId);
  const availableTasks = taskTypes.filter(
    (t) => !t.archived && (t.projectId === '' || t.projectId === projectId)
  );

  const selectedProject = projects.find((p) => p.id === projectId) || null;

  const handleCustomerChange = (newCustomerId: string) => {
    setCustomerId(newCustomerId);
    const matchingProjects = projects.filter((p) => p.customerId === newCustomerId && p.status === 'active');
    const firstProj = matchingProjects[0] || projects.find((p) => p.customerId === newCustomerId) || null;
    setProjectId(firstProj?.id || '');
    const task = taskTypes.find((t) => t.id === taskTypeId) || null;
    setHourlyRate(String(resolveHourlyRate(firstProj, task, date)));
  };

  const handleProjectChange = (newProjectId: string) => {
    setProjectId(newProjectId);
    const proj = projects.find((p) => p.id === newProjectId) || null;
    if (proj && proj.customerId !== customerId) {
      setCustomerId(proj.customerId);
    }
    const task = taskTypes.find((t) => t.id === taskTypeId) || null;
    setHourlyRate(String(resolveHourlyRate(proj, task, date)));
  };

  const handleTaskChange = (newTaskId: string) => {
    setTaskTypeId(newTaskId);
    const task = taskTypes.find((t) => t.id === newTaskId) || null;
    setCustomTaskName(task ? task.name : 'Allmänt arbete');
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
    if (calc !== null && calc > 0 && calc <= 24) {
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
    if (isLocked) return;
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
      await updateTimeEntry(entry.id, {
        customerId,
        projectId,
        taskTypeId,
        taskName: selectedTask ? selectedTask.name : customTaskName || 'Allmänt arbete',
        date,
        startTime,
        endTime,
        hours: parsedHours,
        hourlyRate: parsedRate,
        billable,
        description,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte spara ändringen.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/45 backdrop-blur-xs p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl border border-slate-200 max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {isLocked ? 'Fakturerad tidrapport (låst)' : 'Redigera tidrapport'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Stäng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {isLocked && (
            <div className="p-3.5 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-between gap-3 text-xs text-slate-700">
              <div className="flex items-start gap-2.5">
                <Lock className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />
                <span>
                  Denna registrering markerades som fakturerad {entry.invoicedDate} och är låst mot ändringar.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setConfirmInvoiceMode('undo')}
                className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 font-semibold rounded-lg inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Avfakturera
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Kund</label>
              <select
                disabled={isLocked}
                value={customerId}
                onChange={(e) => handleCustomerChange(e.target.value)}
                className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 disabled:bg-slate-100"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Projekt</label>
              <select
                disabled={isLocked}
                value={projectId}
                onChange={(e) => handleProjectChange(e.target.value)}
                className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 disabled:bg-slate-100"
              >
                {availableProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({resolveProjectRate(p, date)} kr/tim)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Arbetsuppgift</label>
              <select
                disabled={isLocked}
                value={taskTypeId}
                onChange={(e) => handleTaskChange(e.target.value)}
                className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 disabled:bg-slate-100"
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
                disabled={isLocked}
                value={date}
                onChange={(e) => handleDateChange(e.target.value)}
                required
                className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 font-mono tabular-nums disabled:bg-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1.45fr] gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Starttid</label>
              <QuarterTimeSelect
                disabled={isLocked}
                value={startTime}
                options={QUARTER_HOUR_TIMES}
                onChange={(nextStart) => handleTimeRangeChange(nextStart, endTime)}
                ariaLabel="Starttid"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Sluttid</label>
              <QuarterTimeSelect
                disabled={isLocked}
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
                  disabled={isLocked}
                  value={durationHours}
                  onChange={(e) => handleDurationChange(Number(e.target.value), durationMinutes)}
                  aria-label="Timmar"
                  className="w-full h-11 px-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 font-mono tabular-nums disabled:bg-slate-100"
                >
                  {Array.from({ length: 25 }, (_, h) => (
                    <option key={h} value={h}>
                      {h} tim
                    </option>
                  ))}
                </select>
                <select
                  disabled={isLocked || durationHours === 24}
                  value={durationMinutes}
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
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Timpris (kr/tim)</label>
              <input
                type="number"
                step="1"
                min="0"
                max="100000"
                disabled={isLocked}
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 font-mono tabular-nums disabled:bg-slate-100"
              />
            </div>

            <label className="h-11 px-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between cursor-pointer">
              <span className="text-sm font-medium text-slate-700">Debiterbar tid</span>
              <input
                type="checkbox"
                disabled={isLocked}
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
              disabled={isLocked}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Vad utfördes under arbetspasset?"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 disabled:bg-slate-100"
            />
          </div>

          <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-sm text-slate-600">Beräknat belopp</span>
            <span className="text-base font-semibold text-slate-900 font-mono tabular-nums">
              {formatSEK(previewTotal)}
            </span>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              {!isLocked && (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteOpen(true)}
                    className="px-3 py-2.5 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    Radera
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmInvoiceMode('invoice')}
                    className="px-3.5 py-2.5 text-sm font-medium text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Receipt className="w-4 h-4" />
                    Markera fakturerad
                  </button>
                </>
              )}
            </div>
            <div className="flex items-center gap-3 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                {isLocked ? 'Stäng' : 'Avbryt'}
              </button>
              {!isLocked && (
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
                >
                  {saving ? 'Sparar...' : 'Spara ändringar'}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>

      {confirmInvoiceMode && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4">
          <div className="bg-white w-full max-w-md rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">
              {confirmInvoiceMode === 'invoice'
                ? 'Bekräfta fakturering'
                : 'Bekräfta avfakturering'}
            </h3>
            <p className="text-sm text-slate-600">
              {confirmInvoiceMode === 'invoice'
                ? `Vill du markera denna tidregistrering (${entry.date}, ${formatHoursAndMinutes(entry.hours)} · ${formatSEK(entry.billable ? entry.hours * entry.hourlyRate : 0)}) som fakturerad med dagens datum?`
                : `Vill du ångra faktureringsmarkeringen för denna tidregistrering (${entry.date}, ${formatHoursAndMinutes(entry.hours)}) så att den blir redigerbar igen?`}
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={invoiceBusy}
                onClick={() => setConfirmInvoiceMode(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Avbryt
              </button>
              <button
                type="button"
                disabled={invoiceBusy}
                onClick={async () => {
                  setInvoiceBusy(true);
                  setError(null);
                  try {
                    if (confirmInvoiceMode === 'invoice') {
                      await markTimeEntriesInvoiced([entry], todayIsoDate());
                    } else {
                      await unmarkTimeEntriesInvoiced([entry]);
                    }
                    setConfirmInvoiceMode(null);
                    onSaved?.();
                    onClose();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Åtgärden misslyckades.');
                    setConfirmInvoiceMode(null);
                  } finally {
                    setInvoiceBusy(false);
                  }
                }}
                className={`px-4 py-2 text-sm font-semibold text-white rounded-lg cursor-pointer disabled:opacity-60 ${
                  confirmInvoiceMode === 'invoice'
                    ? 'bg-teal-700 hover:bg-teal-800'
                    : 'bg-slate-900 hover:bg-slate-800'
                }`}
              >
                {invoiceBusy
                  ? 'Bearbetar...'
                  : confirmInvoiceMode === 'invoice'
                    ? 'Bekräfta fakturering'
                    : 'Bekräfta avfakturering'}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDeleteOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4">
          <div className="bg-white w-full max-w-md rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">
              Bekräfta borttagning
            </h3>
            <p className="text-sm text-slate-600">
              Vill du ta bort denna tidregistrering ({entry.date},{' '}
              {formatHoursAndMinutes(entry.hours)} · {entry.taskName})? Åtgärden kan inte ångras.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => setConfirmDeleteOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Avbryt
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={async () => {
                  setDeleteBusy(true);
                  setError(null);
                  try {
                    await deleteTimeEntry(entry.id);
                    setConfirmDeleteOpen(false);
                    onSaved?.();
                    onClose();
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : 'Kunde inte ta bort tidsregistreringen.'
                    );
                    setConfirmDeleteOpen(false);
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
