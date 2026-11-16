import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import {
  Briefcase,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
} from 'lucide-react';
import { auth, googleProvider } from './lib/firebase';
import {
  subscribeCustomers,
  subscribeProjects,
  subscribeTaskTypes,
  subscribeTimeEntries,
} from './lib/firestoreService';
import {
  AppTab,
  Customer,
  Project,
  TaskType,
  TimeEntry,
} from './types/timeTracking';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginScreen } from './components/LoginScreen';
import { DashboardView } from './components/DashboardView';
import { ReportsView } from './components/ReportsView';
import { CatalogView } from './components/CatalogView';

const NAV_ITEMS: { id: AppTab; label: string; mobileLabel: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Översikt', mobileLabel: 'Översikt', icon: LayoutDashboard },
  { id: 'reports', label: 'Rapport', mobileLabel: 'Rapport', icon: FileSpreadsheet },
  { id: 'catalog', label: 'Kunder & Projekt', mobileLabel: 'Projekt', icon: Briefcase },
];

function TimeTrackerShell() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [asyncError, setAsyncError] = useState<Error | null>(null);

  if (asyncError) {
    throw asyncError;
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setCustomers([]);
        setProjects([]);
        setTaskTypes([]);
        setEntries([]);
        setDataLoading(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;
    setDataLoading(true);
    let settledCount = 0;
    const markSettled = () => {
      settledCount += 1;
      if (settledCount >= 4) {
        setDataLoading(false);
      }
    };

    try {
      const unsubCust = subscribeCustomers(user.uid, (data) => {
        setCustomers(data);
        markSettled();
      });
      const unsubProj = subscribeProjects(user.uid, (data) => {
        setProjects(data);
        markSettled();
      });
      const unsubTasks = subscribeTaskTypes(user.uid, (data) => {
        setTaskTypes(data);
        markSettled();
      });
      const unsubEntries = subscribeTimeEntries(user.uid, (data) => {
        setEntries(data);
        markSettled();
      });

      return () => {
        unsubCust();
        unsubProj();
        unsubTasks();
        unsubEntries();
      };
    } catch (err) {
      setAsyncError(err instanceof Error ? err : new Error(String(err)));
      return undefined;
    }
  }, [authReady, user]);

  const handleLogin = async () => {
    setLoginBusy(true);
    setLoginError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Kunde inte logga in med Google.';
      if (msg.includes('popup-blocked')) {
        setLoginError('Webbläsaren blockerade popup-fönstret. Tillåt popup-fönster och försök igen.');
      } else if (!msg.includes('popup-closed-by-user')) {
        setLoginError(msg);
      }
    } finally {
      setLoginBusy(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm font-medium text-slate-600">Ansluter...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} loading={loginBusy} error={loginError} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Header Bar with Horizontal Main Navigation */}
      <header className="sticky top-0 z-30 h-14 lg:h-16 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="h-full w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 min-w-0">
            <span className="text-lg lg:text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
              Gött jobbat!
            </span>

            <nav className="hidden lg:flex items-center gap-1" aria-label="Huvudnavigation">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`min-h-[38px] px-3.5 py-2 rounded-xl text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer ${
                      active
                        ? 'bg-teal-50 text-teal-800 font-semibold'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${active ? 'text-teal-700' : 'text-slate-500'}`}
                    />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden lg:flex items-center gap-2.5 pr-1">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'Profilbild'}
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full object-cover border border-slate-200 shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-xs font-bold shrink-0">
                  {(user.displayName || user.email || 'U').slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 max-w-[180px]">
                <p className="text-xs font-semibold text-slate-900 truncate">
                  {user.displayName || 'Företagsanvändare'}
                </p>
                <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              className="hidden lg:inline-flex min-h-[38px] px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Logga ut
            </button>

            <button
              type="button"
              onClick={handleSignOut}
              className="lg:hidden min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 cursor-pointer"
              aria-label="Logga ut"
              title="Logga ut"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <main
          className={`flex-1 w-full py-6 lg:py-8 pb-24 lg:pb-12 ${
            activeTab === 'dashboard' ? '' : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'
          }`}
        >
          {activeTab === 'dashboard' && (
            <DashboardView
              uid={user.uid}
              customers={customers}
              projects={projects}
              taskTypes={taskTypes}
              entries={entries}
              loading={dataLoading}
              onNavigate={setActiveTab}
            />
          )}

          {activeTab === 'reports' && (
            <ReportsView
              customers={customers}
              projects={projects}
              taskTypes={taskTypes}
              entries={entries}
              userName={user.displayName || 'Företagsanvändare'}
              userEmail={user.email || ''}
            />
          )}

          {activeTab === 'catalog' && (
            <CatalogView
              uid={user.uid}
              customers={customers}
              projects={projects}
              taskTypes={taskTypes}
              entries={entries}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Tab Bar (Thumb zone, <= 15% viewport height) */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
        aria-label="Mobilnavigation"
      >
        <div className="grid grid-cols-3 h-16 items-center">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`h-full min-h-[44px] flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer ${
                  active ? 'text-teal-700 font-semibold' : 'text-slate-500'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] leading-none whitespace-nowrap">
                  {item.mobileLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <TimeTrackerShell />
    </ErrorBoundary>
  );
}
