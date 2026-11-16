import { Timestamp } from 'firebase/firestore';

export interface Customer {
  id: string;
  ownerId: string;
  name: string;
  orgNumber: string;
  contactEmail: string;
  notes: string;
  archived: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type ProjectStatus = 'active' | 'archived';

export interface RateHistoryEntry {
  hourlyRate: number | null; // null on TaskType means inherit project hourly rate from effectiveFrom
  effectiveFrom: string; // YYYY-MM-DD
}

export interface Project {
  id: string;
  ownerId: string;
  customerId: string;
  name: string;
  hourlyRate: number; // Mandatory project hourly rate (SEK/tim)
  rateHistory?: RateHistoryEntry[];
  status: ProjectStatus;
  color: string;
  notes: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface TaskType {
  id: string;
  ownerId: string;
  projectId: string; // "" means available across all projects
  name: string;
  hourlyRate: number | null; // Optional override; null = use project's hourly rate
  rateHistory?: RateHistoryEntry[];
  archived: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface TimeEntry {
  id: string;
  ownerId: string;
  customerId: string;
  projectId: string;
  taskTypeId: string;
  taskName: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM or ""
  endTime: string; // HH:MM or ""
  hours: number;
  hourlyRate: number; // Locked snapshot at time of logging/invoicing
  billable: boolean;
  invoiced: boolean;
  invoicedDate: string; // YYYY-MM-DD or ""
  description: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ActiveTimer {
  id: string; // equals ownerId
  ownerId: string;
  customerId: string;
  projectId: string;
  taskTypeId: string;
  description: string;
  startedAtMs: number;
  accumulatedMs: number;
  isRunning: boolean;
  updatedAt?: Timestamp;
}

export type AppTab = 'dashboard' | 'reports' | 'catalog';

export type PeriodPreset =
  | 'this_month'
  | 'last_month'
  | 'this_week'
  | 'this_year'
  | 'all'
  | 'custom';

export type GroupByMode = 'entries' | 'customer' | 'project' | 'task';

export interface ReportFilters {
  period: PeriodPreset;
  startDate: string;
  endDate: string;
  customerIds: string[];
  projectIds: string[];
  taskNames: string[];
  billableOnly: 'all' | 'billable' | 'non_billable';
  invoicedStatus: 'all' | 'unbilled' | 'invoiced';
  search: string;
}
