import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  CheckSquare,
  Download,
  FileSpreadsheet,
  FileText,
  Lock,
  Pencil,
  Receipt,
  RotateCcw,
  Search,
  Square,
  Trash2,
} from 'lucide-react';
import {
  Customer,
  GroupByMode,
  PeriodPreset,
  Project,
  ReportFilters,
  TaskType,
  TimeEntry,
} from '../types/timeTracking';
import {
  formatHours,
  formatHoursPlain,
  formatSEK,
  formatSwedishDate,
  getPeriodBounds,
  todayIsoDate,
} from '../lib/formatters';
import { exportToExcel, exportToPdf } from '../lib/exportReports';
import {
  deleteTimeEntry,
  markTimeEntriesInvoiced,
  unmarkTimeEntriesInvoiced,
} from '../lib/firestoreService';
import { EntryEditModal } from './EntryEditModal';
import { MultiSelectFilter } from './MultiSelectFilter';

interface ReportsViewProps {
  customers: Customer[];
  projects: Project[];
  taskTypes: TaskType[];
  entries: TimeEntry[];
  userName: string;
  userEmail: string;
}

const INITIAL_FILTERS: ReportFilters = {
  period: 'this_month',
  startDate: '',
  endDate: '',
  customerIds: [],
  projectIds: [],
  taskNames: [],
  billableOnly: 'all',
  invoicedStatus: 'all',
  search: '',
};

export function ReportsView({
  customers,
  projects,
  taskTypes,
  entries,
  userName,
  userEmail,
}: ReportsViewProps) {
  const [filters, setFilters] = useState<ReportFilters>(() => {
    const initialBounds = getPeriodBounds(INITIAL_FILTERS.period);
    return {
      ...INITIAL_FILTERS,
      startDate: initialBounds.startDate,
      endDate: initialBounds.endDate,
    };
  });
  const [groupBy, setGroupBy] = useState<GroupByMode>('entries');
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Batch invoicing & undo-invoicing state + confirmation popup
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [invoiceDate, setInvoiceDate] = useState<string>(() => todayIsoDate());
  const [invoicingBusy, setInvoicingBusy] = useState(false);
  const [invoiceBanner, setInvoiceBanner] = useState<string | null>(null);
  const [pendingInvoiceModal, setPendingInvoiceModal] = useState<{
    mode: 'invoice' | 'undo';
    entries: TimeEntry[];
  } | null>(null);

  const customersMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const projectsMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const availableProjects = useMemo(() => {
    if (filters.customerIds.length === 0) return projects;
    return projects.filter((p) => filters.customerIds.includes(p.customerId));
  }, [projects, filters.customerIds]);

  const distinctTaskNames = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => set.add(e.taskName || 'Allmänt arbete'));
    taskTypes.forEach((t) => set.add(t.name));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'sv'));
  }, [entries, taskTypes]);

  const periodBounds = useMemo(
    () => getPeriodBounds(filters.period, filters.startDate, filters.endDate),
    [filters.period, filters.startDate, filters.endDate]
  );

  const filteredEntries = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return entries.filter((e) => {
      if (periodBounds.startDate && e.date < periodBounds.startDate) return false;
      if (periodBounds.endDate && e.date > periodBounds.endDate) return false;
      if (filters.customerIds.length > 0 && !filters.customerIds.includes(e.customerId)) {
        return false;
      }
      if (filters.projectIds.length > 0 && !filters.projectIds.includes(e.projectId)) {
        return false;
      }
      if (
        filters.taskNames.length > 0 &&
        !filters.taskNames.includes(e.taskName || 'Allmänt arbete')
      ) {
        return false;
      }
      if (filters.billableOnly === 'billable' && !e.billable) return false;
      if (filters.billableOnly === 'non_billable' && e.billable) return false;
      if (filters.invoicedStatus === 'unbilled' && e.invoiced) return false;
      if (filters.invoicedStatus === 'invoiced' && !e.invoiced) return false;

      if (q) {
        const custName = customersMap.get(e.customerId)?.name.toLowerCase() || '';
        const projName = projectsMap.get(e.projectId)?.name.toLowerCase() || '';
        const task = (e.taskName || '').toLowerCase();
        const desc = (e.description || '').toLowerCase();
        if (
          !custName.includes(q) &&
          !projName.includes(q) &&
          !task.includes(q) &&
          !desc.includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [entries, filters, periodBounds, customersMap, projectsMap]);

  const unbilledFiltered = useMemo(
    () => filteredEntries.filter((e) => !e.invoiced),
    [filteredEntries]
  );

  const invoicedFiltered = useMemo(
    () => filteredEntries.filter((e) => e.invoiced),
    [filteredEntries]
  );

  const selectedUnbilledEntries = useMemo(
    () => unbilledFiltered.filter((e) => selectedIds.has(e.id)),
    [unbilledFiltered, selectedIds]
  );

  const selectedInvoicedEntries = useMemo(
    () => invoicedFiltered.filter((e) => selectedIds.has(e.id)),
    [invoicedFiltered, selectedIds]
  );

  const selectedUnbilledTotal = useMemo(
    () =>
      selectedUnbilledEntries.reduce(
        (sum, e) => sum + (e.billable ? e.hours * e.hourlyRate : 0),
        0
      ),
    [selectedUnbilledEntries]
  );

  const totals = useMemo(() => {
    let totalHours = 0;
    let billableHours = 0;
    let totalAmount = 0;
    let invoicedAmount = 0;
    let unbilledAmount = 0;
    for (const e of filteredEntries) {
      totalHours += e.hours;
      if (e.billable) {
        const amt = e.hours * e.hourlyRate;
        billableHours += e.hours;
        totalAmount += amt;
        if (e.invoiced) invoicedAmount += amt;
        else unbilledAmount += amt;
      }
    }
    const avgRate = billableHours > 0 ? totalAmount / billableHours : 0;
    return { totalHours, billableHours, totalAmount, invoicedAmount, unbilledAmount, avgRate };
  }, [filteredEntries]);

  const groupedSummary = useMemo(() => {
    if (groupBy === 'entries') return [];
    const map = new Map<
      string,
      {
        key: string;
        title: string;
        subtitle: string;
        count: number;
        hours: number;
        billableHours: number;
        amount: number;
        invoicedAmount: number;
        unbilledAmount: number;
      }
    >();

    for (const e of filteredEntries) {
      const cust = customersMap.get(e.customerId)?.name || 'Okänd kund';
      const proj = projectsMap.get(e.projectId)?.name || 'Okänt projekt';
      let key = '';
      let title = '';
      let subtitle = '';

      if (groupBy === 'customer') {
        key = e.customerId;
        title = cust;
        subtitle = 'Kund';
      } else if (groupBy === 'project') {
        key = e.projectId;
        title = proj;
        subtitle = cust;
      } else {
        key = e.taskName || 'Allmänt arbete';
        title = key;
        subtitle = 'Arbetsuppgift';
      }

      const item = map.get(key) || {
        key,
        title,
        subtitle,
        count: 0,
        hours: 0,
        billableHours: 0,
        amount: 0,
        invoicedAmount: 0,
        unbilledAmount: 0,
      };
      item.count += 1;
      item.hours += e.hours;
      if (e.billable) {
        const amt = e.hours * e.hourlyRate;
        item.billableHours += e.hours;
        item.amount += amt;
        if (e.invoiced) item.invoicedAmount += amt;
        else item.unbilledAmount += amt;
      }
      map.set(key, item);
    }

    return Array.from(map.values()).sort((a, b) => b.amount - a.amount || b.hours - a.hours);
  }, [filteredEntries, groupBy, customersMap, projectsMap]);

  const filterDescription = useMemo(() => {
    const parts: string[] = [];
    if (filters.customerIds.length > 0) {
      parts.push(
        `Kund: ${filters.customerIds
          .map((id) => customersMap.get(id)?.name || '')
          .filter(Boolean)
          .join(', ')}`
      );
    }
    if (filters.projectIds.length > 0) {
      parts.push(
        `Projekt: ${filters.projectIds
          .map((id) => projectsMap.get(id)?.name || '')
          .filter(Boolean)
          .join(', ')}`
      );
    }
    if (filters.taskNames.length > 0) {
      parts.push(`Uppgift: ${filters.taskNames.join(', ')}`);
    }
    if (filters.billableOnly === 'billable') parts.push('Endast debiterbara');
    if (filters.billableOnly === 'non_billable') parts.push('Endast ej debiterbara');
    if (filters.invoicedStatus === 'unbilled') parts.push('Ej fakturerade');
    if (filters.invoicedStatus === 'invoiced') parts.push('Fakturerade');
    if (filters.search.trim()) parts.push(`Sök: "${filters.search.trim()}"`);
    return parts.length > 0 ? parts.join(' · ') : 'Alla kunder, projekt och uppgifter';
  }, [filters, customersMap, projectsMap]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allUnbilledSelected =
    unbilledFiltered.length > 0 && unbilledFiltered.every((e) => selectedIds.has(e.id));

  const toggleSelectAllUnbilled = () => {
    if (allUnbilledSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(unbilledFiltered.map((e) => e.id)));
    }
  };

  const handleConfirmInvoiceAction = async () => {
    if (!pendingInvoiceModal || pendingInvoiceModal.entries.length === 0) return;
    setInvoicingBusy(true);
    setInvoiceBanner(null);
    try {
      if (pendingInvoiceModal.mode === 'invoice') {
        const chosenDate = invoiceDate || todayIsoDate();
        const count = await markTimeEntriesInvoiced(pendingInvoiceModal.entries, chosenDate);
        setSelectedIds(new Set());
        setInvoiceBanner(
          `${count} ${count === 1 ? 'tidregistrering' : 'tidregistreringar'} markerades som fakturerade (${chosenDate}) och låstes mot ändringar.`
        );
      } else {
        const count = await unmarkTimeEntriesInvoiced(pendingInvoiceModal.entries);
        setSelectedIds(new Set());
        setInvoiceBanner(
          `Faktureringsmarkeringen ångrades för ${count} ${count === 1 ? 'tidregistrering' : 'tidregistreringar'}.`
        );
      }
      setPendingInvoiceModal(null);
    } finally {
      setInvoicingBusy(false);
    }
  };

  const handleExportExcel = () => {
    exportToExcel({
      entries: filteredEntries,
      customersMap,
      projectsMap,
      periodLabel: periodBounds.label,
      filterDescription,
      userName,
      userEmail,
    });
  };

  const handleExportPdf = () => {
    exportToPdf({
      entries: filteredEntries,
      customersMap,
      projectsMap,
      periodLabel: periodBounds.label,
      filterDescription,
      userName,
      userEmail,
    });
  };

  const handlePeriodChange = (period: PeriodPreset) => {
    if (period === 'custom') {
      const today = todayIsoDate();
      setFilters((f) => ({
        ...f,
        period,
        startDate: f.startDate || `${today.slice(0, 7)}-01`,
        endDate: f.endDate || today,
      }));
      return;
    }
    const bounds = getPeriodBounds(period);
    setFilters((f) => ({
      ...f,
      period,
      startDate: bounds.startDate,
      endDate: bounds.endDate,
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Rapport
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={filteredEntries.length === 0}
            onClick={handleExportExcel}
            className="min-h-[42px] px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-900 text-sm font-semibold rounded-xl inline-flex items-center gap-2 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-teal-700" />
            Exportera Excel
          </button>
          <button
            type="button"
            disabled={filteredEntries.length === 0}
            onClick={handleExportPdf}
            className="min-h-[42px] px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl inline-flex items-center gap-2 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            Exportera PDF
          </button>
        </div>
      </div>

      {invoiceBanner && (
        <div className="p-4 bg-teal-50 border border-teal-200 rounded-xl flex items-center gap-3 text-sm text-teal-900">
          <CheckCircle2 className="w-5 h-5 text-teal-700 shrink-0" />
          <span className="font-medium">{invoiceBanner}</span>
        </div>
      )}

      {/* Filter Panel */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Period</label>
            <select
              value={filters.period}
              onChange={(e) => handlePeriodChange(e.target.value as PeriodPreset)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
            >
              <option value="this_month">Denna månad</option>
              <option value="last_month">Förra månaden</option>
              <option value="this_week">Denna vecka</option>
              <option value="this_year">I år</option>
              <option value="all">All registrerad tid</option>
              <option value="custom">Anpassat intervall</option>
            </select>
          </div>

          <MultiSelectFilter
            label="Kund"
            allLabel="Alla kunder"
            pluralUnit="kunder"
            ariaLabel="Filtrera på kunder"
            options={customers.map((c) => ({ value: c.id, label: c.name }))}
            selectedValues={filters.customerIds}
            onChange={(nextCustIds) =>
              setFilters((f) => ({
                ...f,
                customerIds: nextCustIds,
                projectIds:
                  nextCustIds.length === 0
                    ? f.projectIds
                    : f.projectIds.filter((pid) => {
                        const custId = projectsMap.get(pid)?.customerId;
                        return custId ? nextCustIds.includes(custId) : false;
                      }),
              }))
            }
          />

          <MultiSelectFilter
            label="Projekt"
            allLabel="Alla projekt"
            pluralUnit="projekt"
            ariaLabel="Filtrera på projekt"
            options={availableProjects.map((p) => ({
              value: p.id,
              label: p.name,
              sublabel: customersMap.get(p.customerId)?.name,
              color: p.color,
            }))}
            selectedValues={filters.projectIds}
            onChange={(nextProjectIds) =>
              setFilters((f) => ({ ...f, projectIds: nextProjectIds }))
            }
          />

          <MultiSelectFilter
            label="Arbetsuppgift"
            allLabel="Alla uppgifter"
            pluralUnit="uppgifter"
            ariaLabel="Filtrera på arbetsuppgifter"
            options={distinctTaskNames.map((t) => ({ value: t, label: t }))}
            selectedValues={filters.taskNames}
            onChange={(nextTaskNames) =>
              setFilters((f) => ({ ...f, taskNames: nextTaskNames }))
            }
          />

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Fakturastatus</label>
            <select
              value={filters.invoicedStatus}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  invoicedStatus: e.target.value as ReportFilters['invoicedStatus'],
                }))
              }
              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
            >
              <option value="all">Alla statusar</option>
              <option value="unbilled">Ej fakturerade</option>
              <option value="invoiced">Redan fakturerade</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Debiterbarhet</label>
            <select
              value={filters.billableOnly}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  billableOnly: e.target.value as ReportFilters['billableOnly'],
                }))
              }
              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
            >
              <option value="all">Alla poster</option>
              <option value="billable">Endast debiterbara</option>
              <option value="non_billable">Ej debiterbara</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 max-w-md">
          <div>
            <label htmlFor="report-start-date" className="block text-xs font-medium text-slate-600 mb-1">
              Startdatum
            </label>
            <input
              id="report-start-date"
              type="date"
              value={filters.startDate}
              onChange={(e) => {
                const nextStart = e.target.value;
                setFilters((f) => ({
                  ...f,
                  period: 'custom',
                  startDate: nextStart,
                  endDate:
                    f.endDate && nextStart && nextStart > f.endDate ? nextStart : f.endDate,
                }));
              }}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono tabular-nums cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-700"
            />
          </div>
          <div>
            <label htmlFor="report-end-date" className="block text-xs font-medium text-slate-600 mb-1">
              Slutdatum
            </label>
            <input
              id="report-end-date"
              type="date"
              value={filters.endDate}
              onChange={(e) => {
                const nextEnd = e.target.value;
                setFilters((f) => ({
                  ...f,
                  period: 'custom',
                  startDate:
                    f.startDate && nextEnd && nextEnd < f.startDate ? nextEnd : f.startDate,
                  endDate: nextEnd,
                }));
              }}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono tabular-nums cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-700"
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="Sök i beskrivning, projekt, kund eller uppgift..."
              className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'entries', label: 'Detaljer' },
                  { id: 'customer', label: 'Per kund' },
                  { id: 'project', label: 'Per projekt' },
                  { id: 'task', label: 'Per uppgift' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setGroupBy(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    groupBy === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                setFilters(INITIAL_FILTERS);
                setSelectedIds(new Set());
              }}
              className="h-9 px-3 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Återställ
            </button>
          </div>
        </div>
      </section>

      {/* Filtered Totals Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white border border-slate-200 rounded-xl p-4">
        <div>
          <p className="text-xs text-slate-500">Total arbetad tid</p>
          <p className="text-lg font-bold text-slate-900 font-mono tabular-nums mt-0.5">
            {formatHours(totals.totalHours)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Redan fakturerat</p>
          <p className="text-lg font-bold text-slate-900 font-mono tabular-nums mt-0.5">
            {formatSEK(totals.invoicedAmount)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Ej fakturerat</p>
          <p className="text-lg font-bold text-teal-700 font-mono tabular-nums mt-0.5">
            {formatSEK(totals.unbilledAmount)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Totalt i urval ({filteredEntries.length} st)</p>
          <p className="text-lg font-bold text-slate-900 font-mono tabular-nums mt-0.5">
            {formatSEK(totals.totalAmount)}
          </p>
        </div>
      </div>

      {/* Batch Invoicing & Undo Bar */}
      {groupBy === 'entries' && (unbilledFiltered.length > 0 || invoicedFiltered.length > 0) && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {unbilledFiltered.length > 0 && (
              <button
                type="button"
                onClick={toggleSelectAllUnbilled}
                className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-2 cursor-pointer"
              >
                {allUnbilledSelected ? (
                  <CheckSquare className="w-4 h-4 text-teal-700" />
                ) : (
                  <Square className="w-4 h-4 text-slate-400" />
                )}
                {allUnbilledSelected
                  ? 'Avmarkera alla'
                  : `Välj alla ofakturerade (${unbilledFiltered.length} st)`}
              </button>
            )}

            <span className="text-xs text-slate-600 font-mono tabular-nums">
              {selectedUnbilledEntries.length > 0
                ? `${selectedUnbilledEntries.length} ofakturerade valda · ${formatSEK(selectedUnbilledTotal)}`
                : selectedInvoicedEntries.length > 0
                  ? `${selectedInvoicedEntries.length} fakturerade valda`
                  : 'Kryssa i rader nedan eller använd snabbval'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {unbilledFiltered.length > 0 && (
              <>
                <label className="text-xs text-slate-600 flex items-center gap-2">
                  Fakturadatum:
                  <input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    className="h-10 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono tabular-nums text-slate-900"
                  />
                </label>

                <button
                  type="button"
                  disabled={invoicingBusy}
                  onClick={() =>
                    setPendingInvoiceModal({
                      mode: 'invoice',
                      entries:
                        selectedUnbilledEntries.length > 0
                          ? selectedUnbilledEntries
                          : unbilledFiltered,
                    })
                  }
                  className="min-h-[40px] px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-semibold rounded-lg inline-flex items-center gap-2 transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  <Receipt className="w-4 h-4" />
                  {selectedUnbilledEntries.length > 0
                    ? `Markera ${selectedUnbilledEntries.length} valda som fakturerade`
                    : `Markera alla ${unbilledFiltered.length} som fakturerade`}
                </button>
              </>
            )}

            {selectedInvoicedEntries.length > 0 && (
              <button
                type="button"
                disabled={invoicingBusy}
                onClick={() =>
                  setPendingInvoiceModal({
                    mode: 'undo',
                    entries: selectedInvoicedEntries,
                  })
                }
                className="min-h-[40px] px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold rounded-lg inline-flex items-center gap-2 transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Avfakturera {selectedInvoicedEntries.length} valda
              </button>
            )}
          </div>
        </section>
      )}

      {/* Results Table or Grouped Summary */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filteredEntries.length === 0 ? (
          <div className="p-10 text-center">
            <Download className="w-6 h-6 text-slate-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-900">
              Inga tidrapporter matchar ditt filter
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Prova att ändra period eller återställ filtren ovan.
            </p>
          </div>
        ) : groupBy === 'entries' ? (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                    <th className="py-3 pl-4 pr-2 w-10">
                      <span className="sr-only">Välj</span>
                    </th>
                    <th className="py-3 px-3">Datum</th>
                    <th className="py-3 px-3">Kund / Projekt</th>
                    <th className="py-3 px-3">Uppgift</th>
                    <th className="py-3 px-3">Beskrivning</th>
                    <th className="py-3 px-3 text-right">Timmar</th>
                    <th className="py-3 px-3 text-right">Timpris</th>
                    <th className="py-3 px-3 text-right">Belopp</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-4 text-right">Åtgärd</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredEntries.map((entry) => {
                    const cust = customersMap.get(entry.customerId)?.name || 'Okänd kund';
                    const proj = projectsMap.get(entry.projectId);
                    const amount = entry.billable ? entry.hours * entry.hourlyRate : 0;
                    const isChecked = selectedIds.has(entry.id);

                    return (
                      <tr
                        key={entry.id}
                        className={`transition-colors ${
                          isChecked ? 'bg-teal-50/40' : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="py-3 pl-4 pr-2">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelect(entry.id)}
                            className="w-4 h-4 accent-teal-700 cursor-pointer"
                            aria-label={`Välj tidrapport ${entry.date}`}
                          />
                        </td>
                        <td className="py-3 px-3 font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                          {entry.date}
                          {entry.startTime && entry.endTime && (
                            <span className="block text-[11px] text-slate-400">
                              {entry.startTime}–{entry.endTime}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2 h-2 rounded-xs shrink-0"
                              style={{ backgroundColor: proj?.color || '#0F766E' }}
                              aria-hidden="true"
                            />
                            <span className="font-medium text-slate-900">
                              {proj?.name || 'Okänt projekt'}
                            </span>
                          </div>
                          <span className="text-xs text-slate-500 pl-4">{cust}</span>
                        </td>
                        <td className="py-3 px-3 text-slate-700">{entry.taskName}</td>
                        <td className="py-3 px-3 text-slate-600 max-w-xs truncate">
                          {entry.description || '—'}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-medium text-slate-900 whitespace-nowrap">
                          {formatHoursPlain(entry.hours)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {entry.billable ? `${Math.round(entry.hourlyRate)} kr` : 'Ej deb.'}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                          {formatSEK(amount)}
                        </td>
                        <td className="py-3 px-3 text-xs whitespace-nowrap">
                          {entry.invoiced ? (
                            <span className="text-teal-800 font-medium">
                              Fakturerad · {entry.invoicedDate}
                            </span>
                          ) : (
                            <span className="text-slate-500">Ej fakturerad</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {entry.invoiced ? (
                            <div className="inline-flex items-center gap-2">
                              <Lock
                                className="w-3.5 h-3.5 text-slate-400"
                                aria-label="Fakturerad och låst"
                              />
                              <button
                                type="button"
                                disabled={invoicingBusy}
                                onClick={() =>
                                  setPendingInvoiceModal({ mode: 'undo', entries: [entry] })
                                }
                                className="px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 border border-slate-200 rounded-md inline-flex items-center gap-1 transition-colors cursor-pointer"
                                title="Ångra faktureringsmarkering"
                              >
                                <RotateCcw className="w-3 h-3" />
                                Avfakturera
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                disabled={invoicingBusy}
                                onClick={() =>
                                  setPendingInvoiceModal({ mode: 'invoice', entries: [entry] })
                                }
                                className="px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 rounded-md transition-colors cursor-pointer"
                                title="Markera som fakturerad"
                              >
                                Fakturera
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingEntry(entry)}
                                className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                                aria-label="Redigera"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              {confirmDeleteId === entry.id ? (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await deleteTimeEntry(entry.id);
                                    setConfirmDeleteId(null);
                                  }}
                                  className="px-2 py-1 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer"
                                >
                                  Radera
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(entry.id)}
                                  className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                                  aria-label="Ta bort"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <div className="md:hidden divide-y divide-slate-100">
              {filteredEntries.map((entry) => {
                const cust = customersMap.get(entry.customerId)?.name || 'Okänd kund';
                const proj = projectsMap.get(entry.projectId);
                const amount = entry.billable ? entry.hours * entry.hourlyRate : 0;
                const isChecked = selectedIds.has(entry.id);

                return (
                  <div key={entry.id} className="p-4 space-y-2">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(entry.id)}
                        className="w-5 h-5 mt-0.5 accent-teal-700 shrink-0"
                        aria-label={`Välj ${entry.date}`}
                      />
                      <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {proj?.name || 'Projekt'} · {entry.taskName}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {formatSwedishDate(entry.date)} · {cust}
                            {entry.invoiced ? ` · Fakturerad (${entry.invoicedDate})` : ' · Ej fakturerad'}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-slate-900 font-mono tabular-nums">
                            {formatHoursPlain(entry.hours)} tim
                          </p>
                          <p className="text-xs text-teal-700 font-mono tabular-nums font-medium">
                            {entry.billable ? formatSEK(amount) : 'Ej deb.'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {entry.description && (
                      <p className="text-xs text-slate-600 pl-8">{entry.description}</p>
                    )}

                    {entry.invoiced ? (
                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          disabled={invoicingBusy}
                          onClick={() =>
                            setPendingInvoiceModal({ mode: 'undo', entries: [entry] })
                          }
                          className="min-h-[36px] px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Avfakturera
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          disabled={invoicingBusy}
                          onClick={() =>
                            setPendingInvoiceModal({ mode: 'invoice', entries: [entry] })
                          }
                          className="min-h-[36px] px-3 text-xs font-semibold text-teal-800 bg-teal-50 rounded-lg cursor-pointer"
                        >
                          Markera fakturerad
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingEntry(entry)}
                          className="min-h-[36px] px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg cursor-pointer"
                        >
                          Ändra
                        </button>
                        {confirmDeleteId === entry.id ? (
                          <button
                            type="button"
                            onClick={async () => {
                              await deleteTimeEntry(entry.id);
                              setConfirmDeleteId(null);
                            }}
                            className="min-h-[36px] px-3 text-xs font-semibold text-white bg-red-600 rounded-lg cursor-pointer"
                          >
                            Bekräfta
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(entry.id)}
                            className="min-h-[36px] px-3 text-xs font-medium text-red-700 bg-red-50 rounded-lg cursor-pointer"
                          >
                            Ta bort
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-5">
                    {groupBy === 'customer'
                      ? 'Kund'
                      : groupBy === 'project'
                        ? 'Projekt'
                        : 'Arbetsuppgift'}
                  </th>
                  <th className="py-3 px-4 text-right">Poster</th>
                  <th className="py-3 px-4 text-right">Totala timmar</th>
                  <th className="py-3 px-4 text-right">Fakturerat</th>
                  <th className="py-3 px-4 text-right">Ej fakturerat</th>
                  <th className="py-3 px-5 text-right">Totalt belopp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {groupedSummary.map((row) => (
                  <tr key={row.key} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-5">
                      <p className="font-semibold text-slate-900">{row.title}</p>
                      {row.subtitle && (
                        <p className="text-xs text-slate-500">{row.subtitle}</p>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-600">
                      {row.count}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-medium text-slate-900">
                      {formatHoursPlain(row.hours)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-600">
                      {formatSEK(row.invoicedAmount)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-teal-700 font-medium">
                      {formatSEK(row.unbilledAmount)}
                    </td>
                    <td className="py-3.5 px-5 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatSEK(row.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <EntryEditModal
        entry={editingEntry}
        customers={customers}
        projects={projects}
        taskTypes={taskTypes}
        onClose={() => setEditingEntry(null)}
      />

      {/* Confirmation Popup Modal for Invoicing and Undo-Invoicing */}
      {pendingInvoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 backdrop-blur-xs p-4">
          <div className="bg-white w-full max-w-md rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">
              {pendingInvoiceModal.mode === 'invoice'
                ? 'Bekräfta fakturering'
                : 'Bekräfta avfakturering'}
            </h2>
            <p className="text-sm text-slate-600">
              {pendingInvoiceModal.mode === 'invoice'
                ? `Vill du markera ${pendingInvoiceModal.entries.length} ${
                    pendingInvoiceModal.entries.length === 1
                      ? 'tidregistrering'
                      : 'tidregistreringar'
                  } som fakturerade (${invoiceDate || todayIsoDate()})?`
                : `Vill du ångra faktureringsmarkeringen för ${pendingInvoiceModal.entries.length} ${
                    pendingInvoiceModal.entries.length === 1
                      ? 'tidregistrering'
                      : 'tidregistreringar'
                  } så att de blir redigerbara igen?`}
            </p>
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs text-slate-700 font-mono tabular-nums">
              <span>
                {formatHours(
                  pendingInvoiceModal.entries.reduce((sum, e) => sum + e.hours, 0)
                )}
              </span>
              <span className="font-semibold text-slate-900">
                {formatSEK(
                  pendingInvoiceModal.entries.reduce(
                    (sum, e) => sum + (e.billable ? e.hours * e.hourlyRate : 0),
                    0
                  )
                )}
              </span>
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={invoicingBusy}
                onClick={() => setPendingInvoiceModal(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Avbryt
              </button>
              <button
                type="button"
                disabled={invoicingBusy}
                onClick={handleConfirmInvoiceAction}
                className={`px-4 py-2 text-sm font-semibold text-white rounded-lg transition-colors disabled:opacity-60 cursor-pointer ${
                  pendingInvoiceModal.mode === 'invoice'
                    ? 'bg-teal-700 hover:bg-teal-800'
                    : 'bg-slate-900 hover:bg-slate-800'
                }`}
              >
                {invoicingBusy
                  ? 'Bearbetar...'
                  : pendingInvoiceModal.mode === 'invoice'
                    ? 'Bekräfta fakturering'
                    : 'Bekräfta avfakturering'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
