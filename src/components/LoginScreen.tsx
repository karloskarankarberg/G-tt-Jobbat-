import { Clock, FileSpreadsheet, ShieldCheck, Smartphone } from 'lucide-react';

interface LoginScreenProps {
  onLogin: () => void;
  loading: boolean;
  error: string | null;
}

export function LoginScreen({ onLogin, loading, error }: LoginScreenProps) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      <header className="w-full max-w-6xl mx-auto px-6 py-6 flex items-center justify-between gap-8">
        <span className="text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          Gött jobbat!
        </span>
        <button
          type="button"
          onClick={onLogin}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
        >
          {loading ? 'Loggar in...' : 'Logga in med Google'}
        </button>
      </header>

      <main className="w-full max-w-6xl mx-auto px-6 py-10 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        <div className="lg:col-span-7 space-y-6">
          <p className="text-sm font-medium text-teal-700">
            Tidrapportering & projektredovisning för din firma
          </p>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-slate-900 leading-[1.12] text-balance">
            Full kontroll på arbetade timmar, kunder och intäkter.
          </h1>
          <p className="text-base sm:text-lg text-slate-600 max-w-2xl leading-relaxed">
            Registrera arbetad tid snabbt i mobilen eller i efterhand, håll isär kunder,
            projekt och arbetsuppgifter med individuella timpriser och exportera färdiga
            underlag till Excel eller PDF.
          </p>

          <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-4">
            <button
              type="button"
              onClick={onLogin}
              disabled={loading}
              className="inline-flex items-center justify-center gap-3 px-6 py-3.5 bg-slate-900 text-white text-sm font-semibold rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-60 cursor-pointer min-h-[48px]"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.8-5.5 3.8-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.2 14.7 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z"
                />
              </svg>
              <span>{loading ? 'Ansluter till Google...' : 'Logga in med ditt Google-konto'}</span>
            </button>
          </div>

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800 max-w-xl">
              {error}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
          <h2 className="text-base font-semibold text-slate-900">
            Allt sparas säkert i din databas
          </h2>
          <div className="divide-y divide-slate-100">
            <div className="py-4 first:pt-0 flex items-start gap-4">
              <div className="w-9 h-9 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                <Smartphone className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Snabbrapportering i mobilen</h3>
                <p className="text-sm text-slate-600 mt-0.5">
                  Starta timer eller logga timmar i efterhand med några få tryck.
                </p>
              </div>
            </div>

            <div className="py-4 flex items-start gap-4">
              <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Timpris per kund, projekt & uppgift</h3>
                <p className="text-sm text-slate-600 mt-0.5">
                  Se månadens upparbetade timmar och räkna på intäkter i realtid.
                </p>
              </div>
            </div>

            <div className="py-4 flex items-start gap-4">
              <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Filtrera & exportera Excel / PDF</h3>
                <p className="text-sm text-slate-600 mt-0.5">
                  Färdiga fakturaunderlag och projektlistor för valfri tidsperiod.
                </p>
              </div>
            </div>

            <div className="py-4 last:pb-0 flex items-start gap-4">
              <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Ingen lokal lagring</h3>
                <p className="text-sm text-slate-600 mt-0.5">
                  All data lagras direkt i molndatabas kopplad till ditt Google-konto.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="w-full max-w-6xl mx-auto px-6 py-6 text-xs text-slate-500">
        Gött jobbat! · Privat företagsdata skyddad per Google-konto
      </footer>
    </div>
  );
}
