import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Customer, Project, TimeEntry } from '../types/timeTracking';
import { formatHoursPlain, formatSEK, todayIsoDate } from './formatters';

export interface ExportContext {
  entries: TimeEntry[];
  customersMap: Map<string, Customer>;
  projectsMap: Map<string, Project>;
  periodLabel: string;
  filterDescription: string;
  userName: string;
  userEmail: string;
}

interface AggregatedGroupRow {
  label: string;
  sublabel: string;
  hours: number;
  billableHours: number;
  amount: number;
  invoicedAmount: number;
  unbilledAmount: number;
  avgRate: number;
  count: number;
}

function buildGroupedRows(
  entries: TimeEntry[],
  customersMap: Map<string, Customer>,
  projectsMap: Map<string, Project>,
  mode: 'project' | 'customer' | 'task'
): AggregatedGroupRow[] {
  const map = new Map<string, AggregatedGroupRow>();

  for (const e of entries) {
    const cust = customersMap.get(e.customerId)?.name || 'Okänd kund';
    const proj = projectsMap.get(e.projectId)?.name || 'Okänt projekt';
    let key = '';
    let label = '';
    let sublabel = '';

    if (mode === 'customer') {
      key = e.customerId;
      label = cust;
      sublabel = '';
    } else if (mode === 'project') {
      key = e.projectId;
      label = proj;
      sublabel = cust;
    } else {
      key = e.taskName || 'Allmänt arbete';
      label = key;
      sublabel = '';
    }

    const existing = map.get(key) || {
      label,
      sublabel,
      hours: 0,
      billableHours: 0,
      amount: 0,
      invoicedAmount: 0,
      unbilledAmount: 0,
      avgRate: 0,
      count: 0,
    };
    existing.hours += e.hours;
    if (e.billable) {
      const amt = e.hours * e.hourlyRate;
      existing.billableHours += e.hours;
      existing.amount += amt;
      if (e.invoiced) {
        existing.invoicedAmount += amt;
      } else {
        existing.unbilledAmount += amt;
      }
    }
    existing.count += 1;
    existing.avgRate = existing.billableHours > 0 ? existing.amount / existing.billableHours : 0;
    map.set(key, existing);
  }

  return Array.from(map.values()).sort((a, b) => b.amount - a.amount || b.hours - a.hours);
}

export function exportToExcel(ctx: ExportContext): void {
  const { entries, customersMap, projectsMap, periodLabel, filterDescription, userName, userEmail } = ctx;

  const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
  const billableHours = entries.reduce((sum, e) => sum + (e.billable ? e.hours : 0), 0);
  const totalAmount = entries.reduce((sum, e) => sum + (e.billable ? e.hours * e.hourlyRate : 0), 0);
  const invoicedAmount = entries.reduce(
    (sum, e) => sum + (e.billable && e.invoiced ? e.hours * e.hourlyRate : 0),
    0
  );
  const unbilledAmount = totalAmount - invoicedAmount;
  const avgRate = billableHours > 0 ? totalAmount / billableHours : 0;

  const projectRows = buildGroupedRows(entries, customersMap, projectsMap, 'project');
  const taskRows = buildGroupedRows(entries, customersMap, projectsMap, 'task');

  const summarySheetData: (string | number)[][] = [
    ['Gött jobbat! — Tidrapport & Sammanställning'],
    ['Skapad av', `${userName} (${userEmail})`],
    ['Rapportdatum', todayIsoDate()],
    ['Period', periodLabel],
    ['Urval / Filter', filterDescription],
    [],
    ['Nyckeltal', 'Värde'],
    ['Antal tidposter', entries.length],
    ['Total arbetad tid (tim)', Math.round(totalHours * 100) / 100],
    ['Debiterbar tid (tim)', Math.round(billableHours * 100) / 100],
    ['Snittimpris (SEK/tim)', Math.round(avgRate)],
    ['Redan fakturerat (SEK)', Math.round(invoicedAmount)],
    ['Ej fakturerat (SEK)', Math.round(unbilledAmount)],
    ['Totalt belopp (SEK)', Math.round(totalAmount)],
    [],
    ['Sammanställning per Projekt & Kund'],
    [
      'Projekt',
      'Kund',
      'Antal poster',
      'Totala timmar',
      'Snittimpris (SEK)',
      'Fakturerat (SEK)',
      'Ej fakturerat (SEK)',
      'Totalt (SEK)',
    ],
    ...projectRows.map((r) => [
      r.label,
      r.sublabel,
      r.count,
      Math.round(r.hours * 100) / 100,
      Math.round(r.avgRate),
      Math.round(r.invoicedAmount),
      Math.round(r.unbilledAmount),
      Math.round(r.amount),
    ]),
  ];

  const taskSheetData: (string | number)[][] = [
    [
      'Arbetsuppgift',
      'Antal poster',
      'Totala timmar',
      'Debiterbara timmar',
      'Snittimpris (SEK)',
      'Belopp (SEK)',
    ],
    ...taskRows.map((r) => [
      r.label,
      r.count,
      Math.round(r.hours * 100) / 100,
      Math.round(r.billableHours * 100) / 100,
      Math.round(r.avgRate),
      Math.round(r.amount),
    ]),
  ];

  const detailedSheetData: (string | number)[][] = [
    [
      'Datum',
      'Kund',
      'Projekt',
      'Uppgift',
      'Starttid',
      'Sluttid',
      'Timmar',
      'Debiterbar',
      'Timpris (SEK)',
      'Belopp (SEK)',
      'Fakturerad',
      'Faktureringsdatum',
      'Beskrivning',
    ],
    ...entries.map((e) => {
      const cust = customersMap.get(e.customerId)?.name || 'Okänd kund';
      const proj = projectsMap.get(e.projectId)?.name || 'Okänt projekt';
      const amount = e.billable ? Math.round(e.hours * e.hourlyRate) : 0;
      return [
        e.date,
        cust,
        proj,
        e.taskName,
        e.startTime || '',
        e.endTime || '',
        Math.round(e.hours * 100) / 100,
        e.billable ? 'Ja' : 'Nej',
        Math.round(e.hourlyRate),
        amount,
        e.invoiced ? 'Ja' : 'Nej',
        e.invoicedDate || '',
        e.description,
      ];
    }),
    [],
    [
      'SUMMA',
      '',
      '',
      '',
      '',
      '',
      Math.round(totalHours * 100) / 100,
      '',
      '',
      Math.round(totalAmount),
      '',
      '',
      '',
    ],
  ];

  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.aoa_to_sheet(summarySheetData);
  const wsTasks = XLSX.utils.aoa_to_sheet(taskSheetData);
  const wsDetails = XLSX.utils.aoa_to_sheet(detailedSheetData);

  wsSummary['!cols'] = [
    { wch: 28 },
    { wch: 24 },
    { wch: 13 },
    { wch: 15 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
  ];
  wsTasks['!cols'] = [
    { wch: 28 },
    { wch: 14 },
    { wch: 16 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
  ];
  wsDetails['!cols'] = [
    { wch: 12 },
    { wch: 22 },
    { wch: 24 },
    { wch: 20 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 11 },
    { wch: 14 },
    { wch: 14 },
    { wch: 11 },
    { wch: 16 },
    { wch: 40 },
  ];

  XLSX.utils.book_append_sheet(wb, wsSummary, 'Sammanställning');
  XLSX.utils.book_append_sheet(wb, wsTasks, 'Per uppgift');
  XLSX.utils.book_append_sheet(wb, wsDetails, 'Detaljerade rader');

  const safeDate = todayIsoDate();
  XLSX.writeFile(wb, `tidrapport-${safeDate}.xlsx`);
}

export function exportToPdf(ctx: ExportContext): void {
  const { entries, customersMap, projectsMap, periodLabel, filterDescription, userName, userEmail } = ctx;

  const docPdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
  const billableHours = entries.reduce((sum, e) => sum + (e.billable ? e.hours : 0), 0);
  const totalAmount = entries.reduce((sum, e) => sum + (e.billable ? e.hours * e.hourlyRate : 0), 0);
  const invoicedAmount = entries.reduce(
    (sum, e) => sum + (e.billable && e.invoiced ? e.hours * e.hourlyRate : 0),
    0
  );
  const unbilledAmount = totalAmount - invoicedAmount;

  docPdf.setFillColor(15, 23, 42);
  docPdf.rect(0, 0, 210, 28, 'F');
  docPdf.setTextColor(255, 255, 255);
  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(17);
  docPdf.text('Tidrapport & Fakturaunderlag', 14, 13);

  docPdf.setFont('helvetica', 'normal');
  docPdf.setFontSize(9.5);
  docPdf.setTextColor(203, 213, 225);
  docPdf.text(`${userName} (${userEmail})  |  Utskriftsdatum: ${todayIsoDate()}`, 14, 21);

  docPdf.setTextColor(15, 23, 42);
  docPdf.setFontSize(10);
  docPdf.setFont('helvetica', 'bold');
  docPdf.text(`Period: ${periodLabel}`, 14, 37);
  docPdf.setFont('helvetica', 'normal');
  docPdf.setFontSize(9);
  docPdf.setTextColor(71, 85, 105);
  docPdf.text(`Urval: ${filterDescription}`, 14, 42.5);

  docPdf.setFillColor(248, 250, 252);
  docPdf.setDrawColor(226, 232, 240);
  docPdf.roundedRect(14, 47, 182, 18, 2, 2, 'FD');

  const kpis = [
    { label: 'Total tid', value: `${formatHoursPlain(totalHours)} tim` },
    { label: 'Fakturerat', value: formatSEK(invoicedAmount) },
    { label: 'Ej fakturerat', value: formatSEK(unbilledAmount) },
    { label: 'Totalt belopp', value: formatSEK(totalAmount) },
  ];
  kpis.forEach((k, idx) => {
    const x = 19 + idx * 45;
    docPdf.setFont('helvetica', 'normal');
    docPdf.setFontSize(8);
    docPdf.setTextColor(100, 116, 139);
    docPdf.text(k.label, x, 53.5);
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(11);
    docPdf.setTextColor(15, 23, 42);
    docPdf.text(k.value, x, 60.5);
  });

  const projectRows = buildGroupedRows(entries, customersMap, projectsMap, 'project');
  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(11);
  docPdf.setTextColor(15, 23, 42);
  docPdf.text('Summering per projekt & kund', 14, 74);

  autoTable(docPdf, {
    startY: 77,
    head: [['Projekt', 'Kund', 'Timmar', 'Fakturerat', 'Ej fakt.', 'Totalt']],
    body: projectRows.map((r) => [
      r.label,
      r.sublabel,
      `${formatHoursPlain(r.hours)} tim`,
      formatSEK(r.invoicedAmount),
      formatSEK(r.unbilledAmount),
      formatSEK(r.amount),
    ]),
    styles: { fontSize: 8.5, cellPadding: 2.5, textColor: [15, 23, 42] },
    headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
    margin: { left: 14, right: 14 },
  });

  const afterSummaryY =
    (docPdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 110;

  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(11);
  docPdf.setTextColor(15, 23, 42);
  docPdf.text('Detaljerade tidrapporter', 14, afterSummaryY + 10);

  autoTable(docPdf, {
    startY: afterSummaryY + 13,
    head: [['Datum', 'Kund / Projekt', 'Uppgift', 'Timmar', 'Pris', 'Belopp', 'Status']],
    body: entries.map((e) => {
      const cust = customersMap.get(e.customerId)?.name || 'Okänd';
      const proj = projectsMap.get(e.projectId)?.name || 'Okänt';
      const amt = e.billable ? e.hours * e.hourlyRate : 0;
      return [
        e.date,
        `${cust}\n${proj}`,
        e.taskName,
        `${formatHoursPlain(e.hours)}`,
        e.billable ? `${Math.round(e.hourlyRate)} kr` : 'Ej deb.',
        formatSEK(amt),
        e.invoiced ? `Fakt. ${e.invoicedDate}` : 'Ej fakt.',
      ];
    }),
    styles: { fontSize: 8, cellPadding: 2.2, textColor: [15, 23, 42], overflow: 'linebreak' },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 21 },
      1: { cellWidth: 38 },
      2: { cellWidth: 28 },
      3: { halign: 'right', cellWidth: 16 },
      4: { halign: 'right', cellWidth: 18 },
      5: { halign: 'right', cellWidth: 22 },
      6: { cellWidth: 'auto' },
    },
    margin: { left: 14, right: 14 },
  });

  const pageCount = docPdf.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    docPdf.setPage(i);
    docPdf.setFontSize(8);
    docPdf.setTextColor(148, 163, 184);
    docPdf.text(
      `Gött jobbat! · Debiterbara timmar: ${formatHoursPlain(billableHours)} tim · Sida ${i} av ${pageCount}`,
      14,
      290
    );
  }

  docPdf.save(`tidrapport-${todayIsoDate()}.pdf`);
}
