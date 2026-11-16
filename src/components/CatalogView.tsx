import React, { useMemo, useState } from 'react';
import { Archive, Lock, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Customer, Project, TaskType, TimeEntry } from '../types/timeTracking';
import {
  buildUpdatedRateHistory,
  createCustomer,
  createProject,
  createTaskType,
  deleteCustomer,
  deleteProject,
  deleteTaskType,
  resolveHourlyRate,
  resolveProjectRate,
  resolveTaskOverrideRate,
  setCustomerArchived,
  setProjectStatus,
  setTaskTypeArchived,
  updateCustomer,
  updateProject,
  updateTaskType,
  updateUnbilledEntriesRates,
} from '../lib/firestoreService';
import { todayIsoDate } from '../lib/formatters';

interface CatalogViewProps {
  uid: string;
  customers: Customer[];
  projects: Project[];
  taskTypes: TaskType[];
  entries: TimeEntry[];
}

const PROJECT_COLORS = [
  '#0F766E',
  '#1D4ED8',
  '#0F172A',
  '#B45309',
  '#6D28D9',
  '#BE123C',
  '#047857',
  '#475569',
];

type CatalogSection = 'tasks' | 'projects' | 'customers';

export function CatalogView({
  uid,
  customers,
  projects,
  taskTypes,
  entries,
}: CatalogViewProps) {
  const [section, setSection] = useState<CatalogSection>('tasks');
  const [showArchived, setShowArchived] = useState(false);

  // Customer form (no hourly rate on customers)
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [custName, setCustName] = useState('');
  const [custOrg, setCustOrg] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [custNotes, setCustNotes] = useState('');
  const [custBusy, setCustBusy] = useState(false);

  // Project form (mandatory hourly rate + dated rate history)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projCustomerId, setProjCustomerId] = useState('');
  const [projName, setProjName] = useState('');
  const [projRate, setProjRate] = useState('');
  const [projEffectiveFrom, setProjEffectiveFrom] = useState(() => todayIsoDate());
  const [updateProjectUnbilledToo, setUpdateProjectUnbilledToo] = useState(false);
  const [projColor, setProjColor] = useState(PROJECT_COLORS[0]);
  const [projNotes, setProjNotes] = useState('');
  const [projBusy, setProjBusy] = useState(false);

  // TaskType form (optional hourly rate override; empty = use project's hourly rate)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskProjectId, setTaskProjectId] = useState('');
  const [taskName, setTaskName] = useState('');
  const [taskRate, setTaskRate] = useState('');
  const [taskEffectiveFrom, setTaskEffectiveFrom] = useState(() => todayIsoDate());
  const [updateUnbilledToo, setUpdateUnbilledToo] = useState(false);
  const [taskBusy, setTaskBusy] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const customersMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const projectsMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const taskTypesMap = useMemo(() => new Map(taskTypes.map((t) => [t.id, t])), [taskTypes]);

  const activeCustomers = useMemo(() => customers.filter((c) => !c.archived), [customers]);
  const activeProjects = useMemo(() => projects.filter((p) => p.status === 'active'), [projects]);

  const visibleCustomers = useMemo(
    () => (showArchived ? customers : activeCustomers),
    [customers, activeCustomers, showArchived]
  );

  const visibleProjects = useMemo(
    () => (showArchived ? projects : activeProjects),
    [projects, activeProjects, showArchived]
  );

  const visibleTasks = useMemo(
    () => (showArchived ? taskTypes : taskTypes.filter((t) => !t.archived)),
    [taskTypes, showArchived]
  );

  const editingProject = useMemo(
    () => (editingProjectId ? projectsMap.get(editingProjectId) || null : null),
    [editingProjectId, projectsMap]
  );

  const editingProjectStats = useMemo(() => {
    if (!editingProjectId) return { unbilled: [] as TimeEntry[], invoicedCount: 0 };
    const matching = entries.filter((e) => e.projectId === editingProjectId);
    const unbilled = matching.filter((e) => {
      if (e.invoiced || e.date < projEffectiveFrom) return false;
      const task = e.taskTypeId ? taskTypesMap.get(e.taskTypeId) : null;
      return resolveTaskOverrideRate(task, e.date) === null;
    });
    return {
      unbilled,
      invoicedCount: matching.filter((e) => e.invoiced).length,
    };
  }, [editingProjectId, entries, projEffectiveFrom, taskTypesMap]);

  const editingTask = useMemo(
    () => (editingTaskId ? taskTypesMap.get(editingTaskId) || null : null),
    [editingTaskId, taskTypesMap]
  );

  const editingTaskStats = useMemo(() => {
    if (!editingTaskId) return { unbilled: [] as TimeEntry[], invoicedCount: 0 };
    const matching = entries.filter((e) => e.taskTypeId === editingTaskId);
    return {
      unbilled: matching.filter((e) => !e.invoiced && e.date >= taskEffectiveFrom),
      invoicedCount: matching.filter((e) => e.invoiced).length,
    };
  }, [editingTaskId, entries, taskEffectiveFrom]);

  const resetCustomerForm = () => {
    setEditingCustomerId(null);
    setCustName('');
    setCustOrg('');
    setCustEmail('');
    setCustNotes('');
    setFormError(null);
  };

  const resetProjectForm = () => {
    setEditingProjectId(null);
    setProjName('');
    setProjRate('');
    setProjEffectiveFrom(todayIsoDate());
    setUpdateProjectUnbilledToo(false);
    setProjNotes('');
    setProjColor(PROJECT_COLORS[0]);
    setFormError(null);
  };

  const resetTaskForm = () => {
    setEditingTaskId(null);
    setTaskProjectId('');
    setTaskName('');
    setTaskRate('');
    setTaskEffectiveFrom(todayIsoDate());
    setUpdateUnbilledToo(false);
    setFormError(null);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    if (!custName.trim()) {
      setFormError('Ange ett kundnamn.');
      return;
    }
    setCustBusy(true);
    try {
      const payload = {
        name: custName,
        orgNumber: custOrg,
        contactEmail: custEmail,
        notes: custNotes,
      };
      if (editingCustomerId) {
        await updateCustomer(editingCustomerId, payload);
        setFormSuccess('Kund uppdaterad.');
      } else {
        const newId = await createCustomer(uid, payload);
        if (!projCustomerId) setProjCustomerId(newId);
        setFormSuccess('Kund skapad.');
      }
      resetCustomerForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Kunde inte spara kund.');
    } finally {
      setCustBusy(false);
    }
  };

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    const chosenCustomerId = projCustomerId || activeCustomers[0]?.id || '';
    if (!chosenCustomerId) {
      setFormError('Skapa en kund först innan du lägger till ett projekt.');
      return;
    }
    if (!projName.trim()) {
      setFormError('Ange ett projektnamn.');
      return;
    }
    const parsedRate = Number(projRate.replace(',', '.'));
    if (projRate.trim() === '' || !Number.isFinite(parsedRate) || parsedRate < 0 || parsedRate > 100000) {
      setFormError('Timpris för projekt måste anges (0–100 000 kr/tim).');
      return;
    }

    setProjBusy(true);
    try {
      if (editingProjectId && editingProject) {
        const currentHistory = editingProject.rateHistory || [];
        const rateChanged = parsedRate !== editingProject.hourlyRate || currentHistory.length === 0;
        let nextHistory = currentHistory;
        let activeRate = parsedRate;

        if (rateChanged) {
          const built = buildUpdatedRateHistory({
            existingHistory: currentHistory,
            previousRate: editingProject.hourlyRate,
            nextRate: parsedRate,
            effectiveFrom: projEffectiveFrom,
            allowNullRate: false,
            createdAt: editingProject.createdAt,
          });
          nextHistory = built.rateHistory;
          activeRate = typeof built.activeTodayRate === 'number' ? built.activeTodayRate : parsedRate;
        }

        await updateProject(editingProjectId, {
          customerId: chosenCustomerId,
          name: projName,
          hourlyRate: activeRate,
          rateHistory: nextHistory,
          color: projColor,
          notes: projNotes,
        });

        let updatedEntriesCount = 0;
        if (rateChanged && updateProjectUnbilledToo && editingProjectStats.unbilled.length > 0) {
          const updatedProjSnapshot: Project = {
            ...editingProject,
            hourlyRate: activeRate,
            rateHistory: nextHistory,
          };
          updatedEntriesCount = await updateUnbilledEntriesRates(
            editingProjectStats.unbilled.map((entry) => ({
              entry,
              hourlyRate: resolveProjectRate(updatedProjSnapshot, entry.date),
            }))
          );
        }

        setFormSuccess(
          rateChanged
            ? updatedEntriesCount > 0
              ? `Projekt uppdaterat med timpris ${parsedRate} kr/tim fr.o.m. ${projEffectiveFrom} och ${updatedEntriesCount} ofakturerade registreringar uppdaterades. Tidigare datum behåller sina tidigare priser.`
              : `Projekt uppdaterat med timpris ${parsedRate} kr/tim fr.o.m. ${projEffectiveFrom}. Tidigare datum och fakturerade timmar behåller sina tidigare priser.`
            : 'Projekt uppdaterat.'
        );
      } else {
        await createProject(uid, {
          customerId: chosenCustomerId,
          name: projName,
          hourlyRate: parsedRate,
          effectiveFrom: projEffectiveFrom,
          color: projColor,
          notes: projNotes,
        });
        setFormSuccess('Projekt skapat.');
      }
      resetProjectForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Kunde inte spara projekt.');
    } finally {
      setProjBusy(false);
    }
  };

  const handleDeleteProjectHistoryItem = async (effectiveFrom: string) => {
    if (!editingProject || !editingProject.rateHistory || editingProject.rateHistory.length <= 1) {
      return;
    }
    setFormError(null);
    setProjBusy(true);
    try {
      const nextHistory = editingProject.rateHistory.filter(
        (item) => item.effectiveFrom !== effectiveFrom
      );
      const updatedProj: Project = { ...editingProject, rateHistory: nextHistory };
      const nextActiveRate = resolveProjectRate(updatedProj, todayIsoDate());
      await updateProject(editingProject.id, {
        customerId: editingProject.customerId,
        name: editingProject.name,
        hourlyRate: nextActiveRate,
        rateHistory: nextHistory,
        color: editingProject.color,
        notes: editingProject.notes,
      });
      setProjRate(String(nextActiveRate));
      setFormSuccess(`Prisperiod fr.o.m. ${effectiveFrom} togs bort.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Kunde inte ta bort prisperiod.');
    } finally {
      setProjBusy(false);
    }
  };

  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    if (!taskName.trim()) {
      setFormError('Ange namn på arbetsuppgiften.');
      return;
    }
    let nextRate: number | null = null;
    if (taskRate.trim() !== '') {
      const parsed = Number(taskRate.replace(',', '.'));
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100000) {
        setFormError('Ange ett giltigt timpris (0–100 000 kr/tim) eller lämna tomt.');
        return;
      }
      nextRate = parsed;
    }

    setTaskBusy(true);
    try {
      if (editingTaskId && editingTask) {
        const rateChanged = nextRate !== editingTask.hourlyRate;
        let nextHistory = editingTask.rateHistory || [];
        let activeRate: number | null = editingTask.hourlyRate;

        if (rateChanged) {
          const built = buildUpdatedRateHistory({
            existingHistory: nextHistory,
            previousRate: editingTask.hourlyRate,
            nextRate,
            effectiveFrom: taskEffectiveFrom,
            allowNullRate: true,
            createdAt: editingTask.createdAt,
          });
          nextHistory = built.rateHistory;
          activeRate = built.activeTodayRate;
        }

        await updateTaskType(editingTaskId, {
          projectId: taskProjectId,
          name: taskName,
          hourlyRate: activeRate,
          rateHistory: nextHistory,
        });

        let updatedEntriesCount = 0;
        if (rateChanged && updateUnbilledToo && editingTaskStats.unbilled.length > 0) {
          const updatedTaskSnapshot: TaskType = {
            ...editingTask,
            hourlyRate: activeRate,
            rateHistory: nextHistory,
          };
          updatedEntriesCount = await updateUnbilledEntriesRates(
            editingTaskStats.unbilled.map((entry) => ({
              entry,
              hourlyRate: resolveHourlyRate(
                projectsMap.get(entry.projectId),
                updatedTaskSnapshot,
                entry.date
              ),
            }))
          );
        }

        setFormSuccess(
          rateChanged
            ? updatedEntriesCount > 0
              ? `Arbetsuppgift uppdaterad (${nextRate !== null ? `${nextRate} kr/tim` : 'projektets timpris'}) fr.o.m. ${taskEffectiveFrom} och ${updatedEntriesCount} ofakturerade tidrapporter uppdaterades. Tidigare datum behåller sina priser.`
              : `Arbetsuppgift uppdaterad (${nextRate !== null ? `${nextRate} kr/tim` : 'projektets timpris'}) fr.o.m. ${taskEffectiveFrom}. Tidigare datum och fakturerade timmar behåller sina ursprungliga priser.`
            : 'Arbetsuppgift uppdaterad.'
        );
      } else {
        await createTaskType(uid, {
          projectId: taskProjectId,
          name: taskName,
          hourlyRate: nextRate,
          effectiveFrom: taskEffectiveFrom,
        });
        setFormSuccess('Arbetsuppgift skapad.');
      }
      resetTaskForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Kunde inte spara uppgift.');
    } finally {
      setTaskBusy(false);
    }
  };

  const handleDeleteTaskHistoryItem = async (effectiveFrom: string) => {
    if (!editingTask || !editingTask.rateHistory) return;
    setFormError(null);
    setTaskBusy(true);
    try {
      const nextHistory = editingTask.rateHistory.filter(
        (item) => item.effectiveFrom !== effectiveFrom
      );
      const updatedTask: TaskType = {
        ...editingTask,
        hourlyRate: null,
        rateHistory: nextHistory,
      };
      const nextActiveRate = resolveTaskOverrideRate(updatedTask, todayIsoDate());
      await updateTaskType(editingTask.id, {
        projectId: editingTask.projectId,
        name: editingTask.name,
        hourlyRate: nextActiveRate,
        rateHistory: nextHistory,
      });
      setTaskRate(nextActiveRate === null ? '' : String(nextActiveRate));
      setFormSuccess(`Prisperiod fr.o.m. ${effectiveFrom} togs bort.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Kunde inte ta bort prisperiod.');
    } finally {
      setTaskBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Kunder & Projekt
          </h1>
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer self-start">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="w-4 h-4 accent-teal-700"
          />
          Visa arkiverade
        </label>
      </div>

      {/* Sub-navigation */}
      <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-xl">
        {(
          [
            { id: 'tasks', label: `Arbetsuppgifter (${visibleTasks.length})` },
            { id: 'projects', label: `Projekt (${visibleProjects.length})` },
            { id: 'customers', label: `Kunder (${visibleCustomers.length})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setSection(tab.id);
              setFormError(null);
              setFormSuccess(null);
            }}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              section === tab.id
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {formError && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {formError}
        </div>
      )}

      {formSuccess && (
        <div className="p-3.5 bg-teal-50 border border-teal-200 rounded-xl text-sm text-teal-900">
          {formSuccess}
        </div>
      )}

      {/* TASK TYPES SECTION (Primary place for hourly rate) */}
      {section === 'tasks' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleSaveTask}
            className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
          >
            <h2 className="text-base font-semibold text-slate-900">
              {editingTaskId ? 'Redigera arbetsuppgift' : 'Ny arbetsuppgift'}
            </h2>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Gäller för projekt
              </label>
              <select
                value={taskProjectId}
                onChange={(e) => setTaskProjectId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
              >
                <option value="">Alla projekt (gemensam uppgiftstyp)</option>
                {activeProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({customersMap.get(p.customerId)?.name || ''})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Uppgiftsnamn
              </label>
              <input
                type="text"
                required
                maxLength={100}
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                placeholder="T.ex. Systemutveckling, Rådgivning, Möte"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Eget timpris (SEK/tim, valfritt)
              </label>
              <input
                type="number"
                min="0"
                max="100000"
                step="1"
                placeholder="Lämnas tomt = projektets timpris"
                value={taskRate}
                onChange={(e) => setTaskRate(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono tabular-nums text-slate-900"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Lämnas tomt som standard så att projektets timpris används.
              </p>
            </div>

            {(taskRate.trim() !== '' || (editingTask && editingTask.hourlyRate !== null)) && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Gäller från (startdatum)
                </label>
                <input
                  type="date"
                  required
                  value={taskEffectiveFrom}
                  onChange={(e) => setTaskEffectiveFrom(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono tabular-nums text-slate-900"
                />
              </div>
            )}

            {editingTaskId && (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                {editingTaskStats.unbilled.length > 0 && (
                  <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={updateUnbilledToo}
                      onChange={(e) => setUpdateUnbilledToo(e.target.checked)}
                      className="w-4 h-4 mt-0.5 accent-teal-700 shrink-0"
                    />
                    <span>
                      Uppdatera även{' '}
                      <strong className="font-mono">{editingTaskStats.unbilled.length}</strong>{' '}
                      ofakturerade tidregistreringar fr.o.m.{' '}
                      <strong className="font-mono">{taskEffectiveFrom}</strong> med denna uppgift.
                    </span>
                  </label>
                )}
                <p className="text-xs text-slate-500 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                  <span>
                    {editingTaskStats.invoicedCount > 0
                      ? `${editingTaskStats.invoicedCount} redan fakturerade registreringar är låsta och ändras aldrig.`
                      : 'Tidigare datum och redan fakturerade registreringar påverkas aldrig av prisändringar.'}
                  </span>
                </p>

                {editingTask?.rateHistory && editingTask.rateHistory.length > 0 && (
                  <div className="pt-2 border-t border-slate-200 space-y-1.5">
                    <p className="text-[11px] font-semibold text-slate-600">Prishistorik</p>
                    <div className="space-y-1">
                      {[...editingTask.rateHistory]
                        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
                        .map((item) => (
                          <div
                            key={item.effectiveFrom}
                            className="flex items-center justify-between text-xs text-slate-700"
                          >
                            <span className="font-mono tabular-nums">
                              Fr.o.m. {item.effectiveFrom}:{' '}
                              <strong>
                                {item.hourlyRate !== null
                                  ? `${item.hourlyRate} kr/tim`
                                  : 'Projektets timpris'}
                              </strong>
                            </span>
                            <button
                              type="button"
                              disabled={taskBusy}
                              onClick={() => handleDeleteTaskHistoryItem(item.effectiveFrom)}
                              className="p-1 text-slate-400 hover:text-red-700 rounded cursor-pointer"
                              aria-label={`Ta bort prisperiod ${item.effectiveFrom}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={taskBusy}
                className="flex-1 h-10 px-4 bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold rounded-lg inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                {taskBusy ? 'Sparar...' : editingTaskId ? 'Spara uppgift' : 'Skapa uppgift'}
              </button>
              {editingTaskId && (
                <button
                  type="button"
                  onClick={resetTaskForm}
                  className="h-10 px-3 text-sm text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Avbryt
                </button>
              )}
            </div>
          </form>

          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {visibleTasks.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Inga arbetsuppgifter tillagda ännu. Skapa dina uppgiftstyper till vänster.
              </div>
            ) : (
              visibleTasks.map((task) => {
                const proj = task.projectId ? projectsMap.get(task.projectId) : null;
                return (
                  <div
                    key={task.id}
                    className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {task.name}
                        {task.archived && (
                          <span className="ml-2 text-xs font-normal text-slate-400">
                            · Arkiverad
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {proj ? `Projekt: ${proj.name}` : 'Gäller alla projekt'} ·{' '}
                        {task.hourlyRate !== null ? (
                          <span className="font-mono tabular-nums font-semibold text-teal-700">
                            {task.hourlyRate} kr/tim (eget pris)
                          </span>
                        ) : (
                          <span className="text-slate-600">
                            Använder projektets timpris
                            {proj ? ` (${resolveProjectRate(proj)} kr/tim)` : ''}
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 self-end sm:self-center">
                      {!task.archived && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTaskId(task.id);
                            setTaskProjectId(task.projectId);
                            setTaskName(task.name);
                            setTaskRate(task.hourlyRate === null ? '' : String(task.hourlyRate));
                            setTaskEffectiveFrom(todayIsoDate());
                            setUpdateUnbilledToo(false);
                            setFormSuccess(null);
                          }}
                          className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
                          aria-label="Redigera uppgift"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setTaskTypeArchived(task, !task.archived)}
                        className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
                        title={task.archived ? 'Återställ' : 'Arkivera'}
                        aria-label={task.archived ? 'Återställ' : 'Arkivera'}
                      >
                        {task.archived ? (
                          <RotateCcw className="w-4 h-4" />
                        ) : (
                          <Archive className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteTaskType(task.id)}
                        className="p-2 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
                        aria-label="Ta bort uppgift"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* PROJECTS SECTION */}
      {section === 'projects' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleSaveProject}
            className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
          >
            <h2 className="text-base font-semibold text-slate-900">
              {editingProjectId ? 'Redigera projekt' : 'Nytt projekt'}
            </h2>

            {activeCustomers.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-600 space-y-3">
                <p>Du behöver lägga till minst en kund innan du kan skapa ett projekt.</p>
                <button
                  type="button"
                  onClick={() => setSection('customers')}
                  className="px-3.5 py-2 bg-teal-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Skapa din första kund
                </button>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Kund</label>
                  <select
                    value={projCustomerId || activeCustomers[0]?.id || ''}
                    onChange={(e) => setProjCustomerId(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
                  >
                    {activeCustomers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Projektnamn
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    value={projName}
                    onChange={(e) => setProjName(e.target.value)}
                    placeholder="T.ex. Webbplattform 2026"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Timpris (SEK/tim) *
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      max="100000"
                      step="1"
                      placeholder="T.ex. 1200"
                      value={projRate}
                      onChange={(e) => setProjRate(e.target.value)}
                      className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono tabular-nums text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Gäller från (startdatum)
                    </label>
                    <input
                      type="date"
                      required
                      value={projEffectiveFrom}
                      onChange={(e) => setProjEffectiveFrom(e.target.value)}
                      className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono tabular-nums text-slate-900"
                    />
                  </div>
                </div>

                {editingProjectId && (
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                    {editingProjectStats.unbilled.length > 0 && (
                      <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={updateProjectUnbilledToo}
                          onChange={(e) => setUpdateProjectUnbilledToo(e.target.checked)}
                          className="w-4 h-4 mt-0.5 accent-teal-700 shrink-0"
                        />
                        <span>
                          Uppdatera även{' '}
                          <strong className="font-mono">
                            {editingProjectStats.unbilled.length}
                          </strong>{' '}
                          ofakturerade registreringar fr.o.m.{' '}
                          <strong className="font-mono">{projEffectiveFrom}</strong> som använder
                          projektets timpris.
                        </span>
                      </label>
                    )}
                    <p className="text-xs text-slate-500 flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                      <span>
                        {editingProjectStats.invoicedCount > 0
                          ? `${editingProjectStats.invoicedCount} redan fakturerade registreringar är låsta och ändras aldrig.`
                          : 'Tidigare år/datum och fakturerade registreringar behåller sina tidigare priser.'}
                      </span>
                    </p>

                    {editingProject?.rateHistory && editingProject.rateHistory.length > 0 && (
                      <div className="pt-2 border-t border-slate-200 space-y-1.5">
                        <p className="text-[11px] font-semibold text-slate-600">Prishistorik</p>
                        <div className="space-y-1">
                          {[...editingProject.rateHistory]
                            .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
                            .map((item) => (
                              <div
                                key={item.effectiveFrom}
                                className="flex items-center justify-between text-xs text-slate-700"
                              >
                                <span className="font-mono tabular-nums">
                                  Fr.o.m. {item.effectiveFrom}:{' '}
                                  <strong>{item.hourlyRate} kr/tim</strong>
                                </span>
                                {editingProject.rateHistory &&
                                  editingProject.rateHistory.length > 1 && (
                                    <button
                                      type="button"
                                      disabled={projBusy}
                                      onClick={() =>
                                        handleDeleteProjectHistoryItem(item.effectiveFrom)
                                      }
                                      className="p-1 text-slate-400 hover:text-red-700 rounded cursor-pointer"
                                      aria-label={`Ta bort prisperiod ${item.effectiveFrom}`}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">
                    Färgmarkör
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {PROJECT_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setProjColor(c)}
                        className={`w-7 h-7 rounded-lg transition-transform cursor-pointer ${
                          projColor.toLowerCase() === c.toLowerCase()
                            ? 'ring-2 ring-offset-2 ring-slate-900 scale-105'
                            : ''
                        }`}
                        style={{ backgroundColor: c }}
                        aria-label={`Välj färg ${c}`}
                      />
                    ))}

                    <label
                      className="inline-flex items-center gap-2 h-8 px-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer text-xs font-medium text-slate-700"
                      title="Välj valfri färg"
                    >
                      <input
                        type="color"
                        value={/^#[0-9a-fA-F]{6}$/.test(projColor) ? projColor : '#0F766E'}
                        onChange={(e) => setProjColor(e.target.value)}
                        className="w-5 h-5 p-0 border-0 bg-transparent cursor-pointer"
                        aria-label="Välj valfri projektfärg"
                      />
                      <span className="font-mono uppercase">{projColor}</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Anteckning (valfritt)
                  </label>
                  <textarea
                    rows={2}
                    maxLength={500}
                    value={projNotes}
                    onChange={(e) => setProjNotes(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={projBusy}
                    className="flex-1 h-10 px-4 bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold rounded-lg inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    {projBusy ? 'Sparar...' : editingProjectId ? 'Uppdatera' : 'Skapa projekt'}
                  </button>
                  {editingProjectId && (
                    <button
                      type="button"
                      onClick={resetProjectForm}
                      className="h-10 px-3 text-sm text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                    >
                      Avbryt
                    </button>
                  )}
                </div>
              </>
            )}
          </form>

          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {visibleProjects.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Inga projekt att visa ännu.
              </div>
            ) : (
              visibleProjects.map((proj) => {
                const cust = customersMap.get(proj.customerId);
                return (
                  <div
                    key={proj.id}
                    className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-3 h-3 rounded-xs shrink-0"
                          style={{ backgroundColor: proj.color }}
                          aria-hidden="true"
                        />
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {proj.name}
                        </p>
                        {proj.status === 'archived' && (
                          <span className="text-xs text-slate-400">· Arkiverad</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 pl-5.5">
                        {cust?.name || 'Okänd kund'} ·{' '}
                        <span className="font-mono tabular-nums font-semibold text-teal-700">
                          {resolveProjectRate(proj)} kr/tim
                        </span>
                        {proj.rateHistory && proj.rateHistory.length > 1
                          ? ` (${proj.rateHistory.length} prisperioder)`
                          : ''}
                        {proj.notes ? ` · ${proj.notes}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 self-end sm:self-center">
                      {proj.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProjectId(proj.id);
                            setProjCustomerId(proj.customerId);
                            setProjName(proj.name);
                            setProjRate(String(resolveProjectRate(proj)));
                            setProjEffectiveFrom(todayIsoDate());
                            setUpdateProjectUnbilledToo(false);
                            setProjColor(proj.color);
                            setProjNotes(proj.notes);
                            setFormSuccess(null);
                          }}
                          className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
                          aria-label="Redigera projekt"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setProjectStatus(
                            proj,
                            proj.status === 'active' ? 'archived' : 'active'
                          )
                        }
                        className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
                        title={proj.status === 'active' ? 'Arkivera' : 'Återställ'}
                        aria-label={proj.status === 'active' ? 'Arkivera' : 'Återställ'}
                      >
                        {proj.status === 'active' ? (
                          <Archive className="w-4 h-4" />
                        ) : (
                          <RotateCcw className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteProject(proj.id)}
                        className="p-2 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
                        aria-label="Ta bort projekt"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* CUSTOMERS SECTION */}
      {section === 'customers' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleSaveCustomer}
            className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
          >
            <h2 className="text-base font-semibold text-slate-900">
              {editingCustomerId ? 'Redigera kund' : 'Ny kund'}
            </h2>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Kundnamn</label>
              <input
                type="text"
                required
                maxLength={100}
                value={custName}
                onChange={(e) => setCustName(e.target.value)}
                placeholder="T.ex. Nordic Tech AB"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Org.nummer (valfritt)
              </label>
              <input
                type="text"
                maxLength={30}
                value={custOrg}
                onChange={(e) => setCustOrg(e.target.value)}
                placeholder="556xxx-xxxx"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Faktura-e-post (valfritt)
              </label>
              <input
                type="email"
                maxLength={120}
                value={custEmail}
                onChange={(e) => setCustEmail(e.target.value)}
                placeholder="ekonomi@kund.se"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Anteckning</label>
              <textarea
                rows={2}
                maxLength={500}
                value={custNotes}
                onChange={(e) => setCustNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={custBusy}
                className="flex-1 h-10 px-4 bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold rounded-lg inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                {custBusy ? 'Sparar...' : editingCustomerId ? 'Uppdatera' : 'Skapa kund'}
              </button>
              {editingCustomerId && (
                <button
                  type="button"
                  onClick={resetCustomerForm}
                  className="h-10 px-3 text-sm text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Avbryt
                </button>
              )}
            </div>
          </form>

          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {visibleCustomers.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Inga kunder registrerade ännu.
              </div>
            ) : (
              visibleCustomers.map((cust) => {
                const projCount = projects.filter((p) => p.customerId === cust.id).length;
                return (
                  <div
                    key={cust.id}
                    className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {cust.name}
                        {cust.archived && (
                          <span className="ml-2 text-xs font-normal text-slate-400">
                            · Arkiverad
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {cust.orgNumber ? `Org.nr ${cust.orgNumber} · ` : ''}
                        {cust.contactEmail ? `${cust.contactEmail} · ` : ''}
                        {projCount} projekt
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 self-end sm:self-center">
                      {!cust.archived && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCustomerId(cust.id);
                            setCustName(cust.name);
                            setCustOrg(cust.orgNumber);
                            setCustEmail(cust.contactEmail);
                            setCustNotes(cust.notes);
                          }}
                          className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
                          aria-label="Redigera kund"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setCustomerArchived(cust.id, !cust.archived)}
                        className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
                        title={cust.archived ? 'Återställ' : 'Arkivera'}
                        aria-label={cust.archived ? 'Återställ' : 'Arkivera'}
                      >
                        {cust.archived ? (
                          <RotateCcw className="w-4 h-4" />
                        ) : (
                          <Archive className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCustomer(cust.id)}
                        className="p-2 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
                        aria-label="Ta bort kund"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
