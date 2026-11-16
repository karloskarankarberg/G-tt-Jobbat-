import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Unsubscribe,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { todayIsoDate, toIsoDate } from './formatters';
import {
  ActiveTimer,
  Customer,
  Project,
  ProjectStatus,
  RateHistoryEntry,
  TaskType,
  TimeEntry,
} from '../types/timeTracking';

const ID_PATTERN = /^[a-zA-Z0-9_\-]+$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function clampString(value: string, maxLen: number): string {
  return (value ?? '').trim().slice(0, maxLen);
}

function clampRate(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(100000, Math.round(value * 100) / 100);
}

function clampHours(value: number): number {
  if (!Number.isFinite(value) || value < 0.25) return 0.25;
  return Math.min(24, Math.max(0.25, Math.round(value * 4) / 4));
}

export function normalizeRateHistory(
  rawHistory: RateHistoryEntry[] | undefined,
  allowNullRate: boolean
): RateHistoryEntry[] {
  if (!Array.isArray(rawHistory)) return [];
  const byDate = new Map<string, RateHistoryEntry>();
  for (const item of rawHistory) {
    if (!item || !ISO_DATE_PATTERN.test(item.effectiveFrom)) continue;
    if (item.hourlyRate === null) {
      if (!allowNullRate) continue;
      byDate.set(item.effectiveFrom, {
        hourlyRate: null,
        effectiveFrom: item.effectiveFrom,
      });
    } else if (typeof item.hourlyRate === 'number' && Number.isFinite(item.hourlyRate)) {
      byDate.set(item.effectiveFrom, {
        hourlyRate: clampRate(item.hourlyRate),
        effectiveFrom: item.effectiveFrom,
      });
    }
  }
  return Array.from(byDate.values())
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
    .slice(-50);
}

function resolveRateFromHistory(
  history: RateHistoryEntry[],
  fallbackRate: number | null,
  dateStr: string
): number | null {
  if (history.length === 0) return fallbackRate;
  const targetDate = ISO_DATE_PATTERN.test(dateStr) ? dateStr : todayIsoDate();
  let matched: RateHistoryEntry | null = null;
  for (const item of history) {
    if (item.effectiveFrom <= targetDate) {
      matched = item;
    } else {
      break;
    }
  }
  if (matched) return matched.hourlyRate;
  return history[0].hourlyRate;
}

export function resolveProjectRate(
  project?: Project | null,
  dateStr: string = todayIsoDate()
): number {
  if (!project) return 0;
  const history = normalizeRateHistory(project.rateHistory, false);
  const fallback = typeof project.hourlyRate === 'number' ? clampRate(project.hourlyRate) : 0;
  const resolved = resolveRateFromHistory(history, fallback, dateStr);
  return typeof resolved === 'number' ? resolved : fallback;
}

export function resolveTaskOverrideRate(
  taskType?: TaskType | null,
  dateStr: string = todayIsoDate()
): number | null {
  if (!taskType) return null;
  const history = normalizeRateHistory(taskType.rateHistory, true);
  const fallback = typeof taskType.hourlyRate === 'number' ? clampRate(taskType.hourlyRate) : null;
  return resolveRateFromHistory(history, fallback, dateStr);
}

export function resolveHourlyRate(
  project?: Project | null,
  taskType?: TaskType | null,
  dateStr: string = todayIsoDate()
): number {
  const taskOverride = resolveTaskOverrideRate(taskType, dateStr);
  if (taskOverride !== null) {
    return taskOverride;
  }
  return resolveProjectRate(project, dateStr);
}

export function buildUpdatedRateHistory(params: {
  existingHistory?: RateHistoryEntry[];
  previousRate: number | null;
  nextRate: number | null;
  effectiveFrom: string;
  allowNullRate: boolean;
  createdAt?: { toDate?: () => Date };
}): { rateHistory: RateHistoryEntry[]; activeTodayRate: number | null } {
  const effectiveFrom = ISO_DATE_PATTERN.test(params.effectiveFrom)
    ? params.effectiveFrom
    : todayIsoDate();
  const normalized = normalizeRateHistory(params.existingHistory, params.allowNullRate);
  const nextVal =
    params.nextRate === null
      ? null
      : clampRate(params.nextRate);

  const byDate = new Map<string, RateHistoryEntry>();
  for (const item of normalized) {
    byDate.set(item.effectiveFrom, item);
  }

  // If no prior history exists and the rate is changing, preserve the previous rate at an earlier baseline date
  if (byDate.size === 0 && params.previousRate !== nextVal) {
    const createdIso = params.createdAt?.toDate ? toIsoDate(params.createdAt.toDate()) : '2000-01-01';
    const baselineDate = createdIso < effectiveFrom ? createdIso : '2000-01-01';
    if (baselineDate < effectiveFrom && (params.allowNullRate || params.previousRate !== null)) {
      byDate.set(baselineDate, {
        hourlyRate: params.previousRate === null ? null : clampRate(params.previousRate),
        effectiveFrom: baselineDate,
      });
    }
  }

  byDate.set(effectiveFrom, {
    hourlyRate: nextVal,
    effectiveFrom,
  });

  const rateHistory = Array.from(byDate.values())
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
    .slice(-50);

  const activeTodayRate = resolveRateFromHistory(rateHistory, nextVal, todayIsoDate());
  return { rateHistory, activeTodayRate };
}

export function subscribeCustomers(
  uid: string,
  onData: (items: Customer[]) => void
): Unsubscribe {
  const path = 'customers';
  const q = query(collection(db, path), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: Customer[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Customer, 'id'>),
      }));
      list.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeProjects(
  uid: string,
  onData: (items: Project[]) => void
): Unsubscribe {
  const path = 'projects';
  const q = query(collection(db, path), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: Project[] = snapshot.docs.map((d) => {
        const raw = d.data() as Partial<Omit<Project, 'id'>>;
        const rateHistory = normalizeRateHistory(raw.rateHistory, false);
        const fallbackRate = typeof raw.hourlyRate === 'number' ? raw.hourlyRate : 0;
        const activeRate = resolveRateFromHistory(rateHistory, fallbackRate, todayIsoDate());
        return {
          id: d.id,
          ownerId: raw.ownerId || uid,
          customerId: raw.customerId || '',
          name: raw.name || '',
          hourlyRate: typeof activeRate === 'number' ? activeRate : fallbackRate,
          rateHistory,
          status: raw.status === 'archived' ? 'archived' : 'active',
          color: raw.color || '#0F766E',
          notes: raw.notes || '',
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
        };
      });
      list.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeTaskTypes(
  uid: string,
  onData: (items: TaskType[]) => void
): Unsubscribe {
  const path = 'taskTypes';
  const q = query(collection(db, path), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: TaskType[] = snapshot.docs.map((d) => {
        const raw = d.data() as Partial<Omit<TaskType, 'id'>>;
        const rateHistory = normalizeRateHistory(raw.rateHistory, true);
        const fallbackRate = typeof raw.hourlyRate === 'number' ? raw.hourlyRate : null;
        const activeRate = resolveRateFromHistory(rateHistory, fallbackRate, todayIsoDate());
        return {
          id: d.id,
          ownerId: raw.ownerId || uid,
          projectId: raw.projectId || '',
          name: raw.name || '',
          hourlyRate: activeRate,
          rateHistory,
          archived: Boolean(raw.archived),
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
        };
      });
      list.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeTimeEntries(
  uid: string,
  onData: (items: TimeEntry[]) => void
): Unsubscribe {
  const path = 'timeEntries';
  const q = query(collection(db, path), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: TimeEntry[] = snapshot.docs.map((d) => {
        const raw = d.data() as Omit<TimeEntry, 'id'>;
        return {
          id: d.id,
          ...raw,
          invoiced: Boolean(raw.invoiced),
          invoicedDate: raw.invoicedDate ?? '',
        };
      });
      list.sort((a, b) => {
        if (b.date !== a.date) return b.date.localeCompare(a.date);
        const bMs = b.createdAt?.toMillis?.() ?? 0;
        const aMs = a.createdAt?.toMillis?.() ?? 0;
        return bMs - aMs;
      });
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeActiveTimer(
  uid: string,
  onData: (timer: ActiveTimer | null) => void
): Unsubscribe {
  const path = `activeTimers/${uid}`;
  return onSnapshot(
    doc(db, 'activeTimers', uid),
    (snapshot) => {
      if (!snapshot.exists()) {
        onData(null);
        return;
      }
      onData({
        id: snapshot.id,
        ...(snapshot.data() as Omit<ActiveTimer, 'id'>),
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export async function createCustomer(
  uid: string,
  input: {
    name: string;
    orgNumber: string;
    contactEmail: string;
    notes: string;
  }
): Promise<string> {
  const path = 'customers';
  const name = clampString(input.name, 100);
  if (!name) throw new Error('Kundnamn måste anges.');
  try {
    const ref = await addDoc(collection(db, path), {
      ownerId: uid,
      name,
      orgNumber: clampString(input.orgNumber, 30),
      contactEmail: clampString(input.contactEmail, 120),
      notes: clampString(input.notes, 500),
      archived: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateCustomer(
  customerId: string,
  input: {
    name: string;
    orgNumber: string;
    contactEmail: string;
    notes: string;
  }
): Promise<void> {
  const path = `customers/${customerId}`;
  const name = clampString(input.name, 100);
  if (!name) throw new Error('Kundnamn måste anges.');
  try {
    await updateDoc(doc(db, 'customers', customerId), {
      name,
      orgNumber: clampString(input.orgNumber, 30),
      contactEmail: clampString(input.contactEmail, 120),
      notes: clampString(input.notes, 500),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function setCustomerArchived(customerId: string, archived: boolean): Promise<void> {
  const path = `customers/${customerId}`;
  try {
    await updateDoc(doc(db, 'customers', customerId), {
      archived,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteCustomer(customerId: string): Promise<void> {
  const path = `customers/${customerId}`;
  try {
    await deleteDoc(doc(db, 'customers', customerId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createProject(
  uid: string,
  input: {
    customerId: string;
    name: string;
    hourlyRate: number;
    effectiveFrom?: string;
    color: string;
    notes: string;
  }
): Promise<string> {
  const path = 'projects';
  const name = clampString(input.name, 120);
  if (!name) throw new Error('Projektnamn måste anges.');
  if (!ID_PATTERN.test(input.customerId)) throw new Error('Ogiltig kund.');
  if (!Number.isFinite(input.hourlyRate) || input.hourlyRate < 0) {
    throw new Error('Timpris för projekt måste anges.');
  }
  const rate = clampRate(input.hourlyRate);
  const effectiveFrom =
    input.effectiveFrom && ISO_DATE_PATTERN.test(input.effectiveFrom)
      ? input.effectiveFrom
      : todayIsoDate();
  const rateHistory: RateHistoryEntry[] = [{ hourlyRate: rate, effectiveFrom }];
  try {
    const ref = await addDoc(collection(db, path), {
      ownerId: uid,
      customerId: input.customerId,
      name,
      hourlyRate: rate,
      rateHistory,
      status: 'active',
      color: clampString(input.color || '#0F766E', 20),
      notes: clampString(input.notes, 500),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateProject(
  projectId: string,
  input: {
    customerId: string;
    name: string;
    hourlyRate: number;
    rateHistory: RateHistoryEntry[];
    color: string;
    notes: string;
  }
): Promise<void> {
  const path = `projects/${projectId}`;
  const name = clampString(input.name, 120);
  if (!name) throw new Error('Projektnamn måste anges.');
  if (!Number.isFinite(input.hourlyRate) || input.hourlyRate < 0) {
    throw new Error('Timpris för projekt måste anges.');
  }
  const normalizedHistory = normalizeRateHistory(input.rateHistory, false);
  try {
    await updateDoc(doc(db, 'projects', projectId), {
      customerId: input.customerId,
      name,
      hourlyRate: clampRate(input.hourlyRate),
      rateHistory: normalizedHistory,
      color: clampString(input.color || '#0F766E', 20),
      notes: clampString(input.notes, 500),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function setProjectStatus(project: Project, status: ProjectStatus): Promise<void> {
  const path = `projects/${project.id}`;
  try {
    await updateDoc(doc(db, 'projects', project.id), {
      status,
      hourlyRate: typeof project.hourlyRate === 'number' ? clampRate(project.hourlyRate) : 0,
      rateHistory: normalizeRateHistory(project.rateHistory, false),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteProject(projectId: string): Promise<void> {
  const path = `projects/${projectId}`;
  try {
    await deleteDoc(doc(db, 'projects', projectId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createTaskType(
  uid: string,
  input: {
    projectId: string;
    name: string;
    hourlyRate: number | null;
    effectiveFrom?: string;
  }
): Promise<string> {
  const path = 'taskTypes';
  const name = clampString(input.name, 100);
  if (!name) throw new Error('Uppgiftsnamn måste anges.');
  const projectId = input.projectId ? clampString(input.projectId, 128) : '';
  const hourlyRate = input.hourlyRate === null ? null : clampRate(input.hourlyRate);
  const effectiveFrom =
    input.effectiveFrom && ISO_DATE_PATTERN.test(input.effectiveFrom)
      ? input.effectiveFrom
      : todayIsoDate();
  const rateHistory: RateHistoryEntry[] =
    hourlyRate === null ? [] : [{ hourlyRate, effectiveFrom }];
  try {
    const ref = await addDoc(collection(db, path), {
      ownerId: uid,
      projectId,
      name,
      hourlyRate,
      rateHistory,
      archived: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateTaskType(
  taskTypeId: string,
  input: {
    projectId: string;
    name: string;
    hourlyRate: number | null;
    rateHistory: RateHistoryEntry[];
  }
): Promise<void> {
  const path = `taskTypes/${taskTypeId}`;
  const name = clampString(input.name, 100);
  if (!name) throw new Error('Uppgiftsnamn måste anges.');
  const hourlyRate = input.hourlyRate === null ? null : clampRate(input.hourlyRate);
  const normalizedHistory = normalizeRateHistory(input.rateHistory, true);
  try {
    await updateDoc(doc(db, 'taskTypes', taskTypeId), {
      projectId: input.projectId ? clampString(input.projectId, 128) : '',
      name,
      hourlyRate,
      rateHistory: normalizedHistory,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Updates hourlyRate ONLY on unbilled (invoiced === false) time entries,
 * passing explicit target rates per entry so date-scoped and fallback project rates apply cleanly.
 */
export async function updateUnbilledEntriesRates(
  updates: { entry: TimeEntry; hourlyRate: number }[]
): Promise<number> {
  const targets = updates.filter((u) => !u.entry.invoiced);
  if (targets.length === 0) return 0;
  const path = 'timeEntries';
  try {
    for (let i = 0; i < targets.length; i += 450) {
      const chunk = targets.slice(i, i + 450);
      const batch = writeBatch(db);
      for (const item of chunk) {
        batch.update(doc(db, path, item.entry.id), {
          hourlyRate: clampRate(item.hourlyRate),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
    return targets.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function setTaskTypeArchived(task: TaskType, archived: boolean): Promise<void> {
  const path = `taskTypes/${task.id}`;
  try {
    await updateDoc(doc(db, 'taskTypes', task.id), {
      archived,
      rateHistory: normalizeRateHistory(task.rateHistory, true),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteTaskType(taskTypeId: string): Promise<void> {
  const path = `taskTypes/${taskTypeId}`;
  try {
    await deleteDoc(doc(db, 'taskTypes', taskTypeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createTimeEntry(
  uid: string,
  input: {
    customerId: string;
    projectId: string;
    taskTypeId: string;
    taskName: string;
    date: string;
    startTime: string;
    endTime: string;
    hours: number;
    hourlyRate: number;
    billable: boolean;
    description: string;
  }
): Promise<string> {
  const path = 'timeEntries';
  if (!ID_PATTERN.test(input.customerId) || !ID_PATTERN.test(input.projectId)) {
    throw new Error('Kund och projekt måste väljas.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new Error('Ogiltigt datumformat.');
  }
  const taskName = clampString(input.taskName || 'Allmänt arbete', 100);
  const startTime = /^\d{2}:\d{2}$/.test(input.startTime) ? input.startTime : '';
  const endTime = /^\d{2}:\d{2}$/.test(input.endTime) ? input.endTime : '';
  try {
    const ref = await addDoc(collection(db, path), {
      ownerId: uid,
      customerId: input.customerId,
      projectId: input.projectId,
      taskTypeId: input.taskTypeId ? clampString(input.taskTypeId, 128) : '',
      taskName,
      date: input.date,
      startTime,
      endTime,
      hours: clampHours(input.hours),
      hourlyRate: clampRate(input.hourlyRate),
      billable: Boolean(input.billable),
      invoiced: false,
      invoicedDate: '',
      description: clampString(input.description, 500),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateTimeEntry(
  entryId: string,
  input: {
    customerId: string;
    projectId: string;
    taskTypeId: string;
    taskName: string;
    date: string;
    startTime: string;
    endTime: string;
    hours: number;
    hourlyRate: number;
    billable: boolean;
    description: string;
  }
): Promise<void> {
  const path = `timeEntries/${entryId}`;
  const taskName = clampString(input.taskName || 'Allmänt arbete', 100);
  const startTime = /^\d{2}:\d{2}$/.test(input.startTime) ? input.startTime : '';
  const endTime = /^\d{2}:\d{2}$/.test(input.endTime) ? input.endTime : '';
  try {
    await updateDoc(doc(db, 'timeEntries', entryId), {
      customerId: input.customerId,
      projectId: input.projectId,
      taskTypeId: input.taskTypeId ? clampString(input.taskTypeId, 128) : '',
      taskName,
      date: input.date,
      startTime,
      endTime,
      hours: clampHours(input.hours),
      hourlyRate: clampRate(input.hourlyRate),
      billable: Boolean(input.billable),
      description: clampString(input.description, 500),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function markTimeEntriesInvoiced(
  entriesToInvoice: TimeEntry[],
  invoicedDate: string
): Promise<number> {
  const unbilled = entriesToInvoice.filter((e) => !e.invoiced);
  if (unbilled.length === 0) return 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoicedDate)) {
    throw new Error('Ogiltigt faktureringsdatum.');
  }
  const path = 'timeEntries';
  try {
    for (let i = 0; i < unbilled.length; i += 450) {
      const chunk = unbilled.slice(i, i + 450);
      const batch = writeBatch(db);
      for (const entry of chunk) {
        batch.update(doc(db, path, entry.id), {
          invoiced: true,
          invoicedDate,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
    return unbilled.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function unmarkTimeEntriesInvoiced(
  entriesToUndo: TimeEntry[]
): Promise<number> {
  const invoiced = entriesToUndo.filter((e) => e.invoiced);
  if (invoiced.length === 0) return 0;
  const path = 'timeEntries';
  try {
    for (let i = 0; i < invoiced.length; i += 450) {
      const chunk = invoiced.slice(i, i + 450);
      const batch = writeBatch(db);
      for (const entry of chunk) {
        batch.update(doc(db, path, entry.id), {
          invoiced: false,
          invoicedDate: '',
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
    return invoiced.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteTimeEntry(entryId: string): Promise<void> {
  const path = `timeEntries/${entryId}`;
  try {
    await deleteDoc(doc(db, 'timeEntries', entryId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function upsertActiveTimer(
  uid: string,
  input: {
    customerId: string;
    projectId: string;
    taskTypeId: string;
    description: string;
    startedAtMs: number;
    accumulatedMs: number;
    isRunning: boolean;
  }
): Promise<void> {
  const path = `activeTimers/${uid}`;
  try {
    await setDoc(doc(db, 'activeTimers', uid), {
      ownerId: uid,
      customerId: input.customerId,
      projectId: input.projectId,
      taskTypeId: input.taskTypeId ? clampString(input.taskTypeId, 128) : '',
      description: clampString(input.description, 500),
      startedAtMs: Math.max(0, Math.floor(input.startedAtMs)),
      accumulatedMs: Math.max(0, Math.floor(input.accumulatedMs)),
      isRunning: Boolean(input.isRunning),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function clearActiveTimer(uid: string): Promise<void> {
  const path = `activeTimers/${uid}`;
  try {
    await deleteDoc(doc(db, 'activeTimers', uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
