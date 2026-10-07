import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import {
  Activity, AlertCircle, ArrowDownRight, ArrowRight, BarChart3,
  Check, CircleHelp, Clock3, Cpu, FileText, House, Lightbulb,
  LoaderCircle, LogOut, Plus, Power, RefreshCw, Search, Settings2, ShieldCheck,
  Sparkles, Trash2, TrendingDown, WashingMachine, X, Zap,
} from 'lucide-react';
import {
  useCreateAutomationRule, useCreateDevice, useCreateUsage, useDeleteAutomationRule,
  useDeleteDevice, useDeleteUsage, useGetCurrentUser, useGetDashboard, useGetTariff,
  useListAutomationActions, useListAutomationRules, useListDevices, useListUsage,
  useListWasteEvents, useLogin, useLogout, useRegister, useRunEnergyAnalysis,
  useRunSimulation, useSetAutomationRuleEnabled, useUpdateAutomationRule,
  useUpdateDevice, useUpdateTariff, useUpdateUsage, useUpdateWasteStatus, useHealthCheck,
  getGetDashboardQueryKey, getGetTariffQueryKey,
  getGetLatestEnergyAnalysisQueryKey,
  getListAutomationActionsQueryKey, getListAutomationRulesQueryKey,
  getListDevicesQueryKey, getListUsageQueryKey, getListWasteEventsQueryKey,
  useGetLatestEnergyAnalysis,
} from '@workspace/api-client-react';
import type { AutomationRule, Device, UsageRecord, WasteEvent } from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const money = (v: number) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const num = (v: number, digits = 1) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: digits });
const dateLabel = (s?: string | null) => s ? new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const dayLabel = (s: string) => new Date(s).toLocaleDateString('en-IN', { weekday: 'short' });
const deviceTypes = ['AC', 'Fan', 'Light', 'TV', 'Refrigerator', 'Washing Machine', 'Computer', 'Heater', 'Other'];

function invalidate(qc: ReturnType<typeof useQueryClient>, keys: (readonly unknown[])[]) {
  keys.forEach(queryKey => { void qc.invalidateQueries({ queryKey }); });
}

function Button({ children, onClick, variant = 'primary', disabled, type = 'button', className = '' }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'quiet' | 'outline' | 'danger'; disabled?: boolean; type?: 'button' | 'submit'; className?: string;
}) {
  return <button type={type} onClick={onClick} disabled={disabled} className={`btn btn-${variant} ${className}`} data-testid="button-action">{children}</button>;
}
function IconButton({ label, onClick, children, danger = false }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return <button className={`icon-button ${danger ? 'icon-danger' : ''}`} aria-label={label} title={label} onClick={onClick} data-testid={`button-${label.toLowerCase().replaceAll(' ', '-')}`}>{children}</button>;
}
function Panel({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`panel ${className}`}>{children}</section>; }
function SectionTitle({ eyebrow, title, detail, action }: { eyebrow?: string; title: string; detail?: string; action?: ReactNode }) {
  return <div className="section-title"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action}</div>;
}
function Skeleton({ lines = 3 }: { lines?: number }) { return <div className="skeleton-stack" aria-label="Loading">{Array.from({ length: lines }, (_, i) => <div className="skeleton-line" key={i} />)}</div>; }
function QueryState({ loading, error, retry, children }: { loading?: boolean; error?: boolean; retry?: () => void; children: ReactNode }) {
  if (loading) return <Panel><Skeleton /></Panel>;
  if (error) return <Panel className="state-card"><AlertCircle size={22} /><strong>We couldn't load this view.</strong><span>Check your connection, then try again.</span><Button variant="outline" onClick={retry}>Try again</Button></Panel>;
  return <>{children}</>;
}
function InlineError({ children }: { children: ReactNode }) {
  return <div className="form-error" role="alert"><AlertCircle size={16} />{children}</div>;
}
function Empty({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-mark"><Activity size={20} /></div><strong>{title}</strong><p>{message}</p>{action}</div>;
}
function Modal({ title, eyebrow, close, children, wide = false }: { title: string; eyebrow?: string; close: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && close()}><div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true"><div className="modal-head"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2></div><IconButton label="Close" onClick={close}><X size={18} /></IconButton></div>{children}</div></div>;
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`input ${props.className || ''}`} />; }
function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`input ${props.className || ''}`} />; }
function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) { return <span className={`pill pill-${tone}`}>{children}</span>; }

function AuthPage({ register = false }: { register?: boolean }) {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const auth = register ? useRegister() : useLogin();
  const qc = useQueryClient();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (password.length < 10) { setFormError('Use at least 10 characters for your password.'); return; }
    auth.mutate({ data: { email, password } }, {
      onSuccess: () => { qc.clear(); setLocation('/'); },
      onError: () => setFormError(register ? 'This account could not be created. Check the details and try again.' : 'Those details did not match an account. Please try again.'),
    });
  };
  return <main className="auth-page">
    <div className="auth-aside"><Link href="/login" className="brand"><span className="brand-mark"><Zap size={18} fill="currentColor" /></span><span>SA7 <b>SMART ENERGY</b></span></Link>
      <div className="auth-message"><div className="live-indicator"><span /> HOUSEHOLD ENERGY, MADE LEGIBLE</div><h1>See what’s<br />using <em>your</em> energy.</h1><p>Understand the appliances behind your bill. Catch waste early. Let simple automations do the follow-through.</p>
        <div className="auth-proof"><span><ShieldCheck size={17} /> Private by design</span><span><Activity size={17} /> Live device picture</span></div>
      </div><div className="auth-foot">A clearer view of everyday energy.</div>
    </div>
    <div className="auth-form-side"><div className="auth-form-wrap"><div className="eyebrow">{register ? 'GET STARTED' : 'WELCOME BACK'}</div><h2>{register ? 'Create your account' : 'Sign in to your space'}</h2><p className="auth-sub">{register ? 'Start with a more useful view of your electricity.' : 'Your energy picture is ready when you are.'}</p>
      <form onSubmit={submit} className="stack-form">
        <Field label="Email address"><TextInput data-testid="input-email" type="email" required maxLength={254} autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <Field label="Password" hint="At least 10 characters"><TextInput data-testid="input-password" type="password" required minLength={10} maxLength={128} autoComplete={register ? 'new-password' : 'current-password'} placeholder="Enter your password" value={password} onChange={e => setPassword(e.target.value)} /></Field>
        {formError && <div className="form-error"><AlertCircle size={16} />{formError}</div>}
        <Button type="submit" disabled={auth.isPending} className="full-button">{auth.isPending ? <><LoaderCircle className="spin" size={17} /> Working…</> : register ? 'Create account' : 'Sign in'}<ArrowRight size={17} /></Button>
      </form>
      <div className="auth-switch">{register ? 'Already have an account?' : 'New to SA7?'} <Link href={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create an account'}</Link></div>
      <div className="auth-footnote"><LockNote /> Your account data stays attached to your session.</div>
    </div></div>
  </main>;
}
function LockNote() { return <span className="lock-note"><ShieldCheck size={14} /> Secure session</span>; }

const navItems = [
  { href: '/', label: 'Overview', icon: House },
  { href: '/devices', label: 'Devices', icon: Cpu },
  { href: '/usage', label: 'Energy usage', icon: BarChart3 },
  { href: '/automation', label: 'Automation', icon: Settings2 },
  { href: '/analysis', label: 'Waste & analysis', icon: Lightbulb },
];
function ProtectedShell({ path }: { path: string }) {
  const [, setLocation] = useLocation();
  const user = useGetCurrentUser();
  const logout = useLogout();
  const [mobileNav, setMobileNav] = useState(false);
  const qc = useQueryClient();
  useEffect(() => {
    if (!user.isLoading && (user.isError || !user.data)) {
      qc.clear();
      setLocation('/login');
    }
  }, [user.isLoading, user.isError, user.data, setLocation, qc]);
  if (user.isLoading) return <div className="auth-loading"><span className="loader-ring" /><span>Checking your secure session</span></div>;
  if (user.isError || !user.data) return <div className="auth-loading"><span className="loader-ring" /><span>Returning to sign in</span></div>;
  const title = navItems.find(n => n.href === path)?.label || 'Overview';
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <Link href="/" className="brand sidebar-brand" onClick={() => setMobileNav(false)}><span className="brand-mark"><Zap size={18} fill="currentColor" /></span><span>SA7 <b>SMART ENERGY</b></span></Link>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <nav className="side-nav">{navItems.map(item => { const Icon = item.icon; return <Link key={item.href} href={item.href} onClick={() => setMobileNav(false)} className={`nav-link ${path === item.href ? 'nav-active' : ''}`} data-testid={`link-${item.label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={18} /><span>{item.label}</span>{item.href === '/analysis' && <span className="nav-dot" />}</Link>; })}</nav>
       <div className="sidebar-bottom"><div className="sidebar-note"><div className="note-icon"><CircleHelp size={16} /></div><strong>Built for clarity</strong><p>Energy and costs, in the units that matter.</p></div><div className="user-row"><div className="avatar">{user.data.email.slice(0, 1).toUpperCase()}</div><div className="user-meta"><strong>{user.data.email.split('@')[0]}</strong><span>{user.data.email}</span></div><IconButton label="Sign out" onClick={() => logout.mutate(undefined, { onSuccess: () => { qc.clear(); setLocation('/login'); } })}><LogOut size={16} /></IconButton></div></div>
    </aside>
    {mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
    <main className="main-area"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(v => !v)} aria-label="Open navigation"><span /><span /><span /></button><div className="breadcrumb"><span>SA7</span><span className="breadcrumb-slash">/</span><strong>{title}</strong></div><div className="topbar-right"><HealthStatus /><span className="topbar-date">{new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span><div className="avatar avatar-small">{user.data.email.slice(0, 1).toUpperCase()}</div></div></header>
      <div className="page-content">{path === '/' ? <DashboardPage /> : path === '/devices' ? <DevicesPage /> : path === '/usage' ? <UsagePage /> : path === '/automation' ? <AutomationPage /> : path === '/analysis' ? <AnalysisPage /> : <NotFound />}</div>
    </main>
  </div>;
}
function HealthStatus() {
  const health = useHealthCheck();
  return <div className={`connection ${health.isError ? 'connection-error' : ''}`} title={health.isError ? 'Connection unavailable' : 'Service connected'}><span />{health.isLoading ? 'Checking' : health.isError ? 'Offline' : 'Connected'}</div>;
}

function DashboardPage() {
  const dashboard = useGetDashboard();
  const devices = useListDevices();
  const qc = useQueryClient();
  const runSimulation = useRunSimulation();
  const tariff = useGetTariff();
  const updateTariff = useUpdateTariff();
  const [tariffEdit, setTariffEdit] = useState(false);
  const [tariffValue, setTariffValue] = useState('');
  const [toast, setToast] = useState('');
  const d = dashboard.data;
  const sim = () => runSimulation.mutate({ data: { durationMinutes: 30 } }, { onSuccess: result => { invalidate(qc, [getGetDashboardQueryKey(), getListDevicesQueryKey(), getListUsageQueryKey(), getListWasteEventsQueryKey(), getListAutomationActionsQueryKey()]); setToast(`Simulation complete · ${result.recordsCreated} records added`); }, onError: () => setToast('Simulation could not run. Please retry.') });
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">ENERGY AT A GLANCE</div><h1>Your energy, <em>in focus.</em></h1><p>A practical picture of what’s running, what it costs, and where small changes add up.</p></div><Button variant="outline" onClick={sim} disabled={runSimulation.isPending}><RefreshCw size={16} className={runSimulation.isPending ? 'spin' : ''} />{runSimulation.isPending ? 'Running simulation' : 'Run 30 min simulation'}</Button></div>
    {toast && <div className="inline-notice" role="status"><Check size={16} />{toast}<IconButton label="Close" onClick={() => setToast('')}><X size={14} /></IconButton></div>}
    <QueryState loading={dashboard.isLoading} error={dashboard.isError} retry={() => void dashboard.refetch()}>
      {d && <><div className="metric-grid">
        <MetricCard label="Current load" value={`${num(d.currentLoadKw, 2)} kW`} sub={`${d.deviceSummary.on} devices switched on`} icon={<Activity size={18} />} accent="mint" />
        <MetricCard label="Energy today" value={`${num(d.energyTodayKwh, 2)} kWh`} sub={`${num(d.energyMonthKwh, 1)} kWh this month`} icon={<Zap size={18} />} accent="lime" />
        <MetricCard label="Estimated cost" value={money(d.estimatedCostInr)} sub="Based on your current tariff" icon={<FileText size={18} />} accent="sand" />
        <MetricCard label="Waste identified" value={`${num(d.wastedEnergyKwh, 2)} kWh`} sub={`${money(d.potentialSavingsInr)} potential savings`} icon={<TrendingDown size={18} />} accent="rose" />
      </div>
      <div className="dashboard-grid"><Panel className="trend-panel"><div className="panel-heading"><div><div className="eyebrow">LAST 7 DAYS</div><h3>Daily energy use</h3></div><StatusPill tone="mint"><span className="mini-dot" /> Live picture</StatusPill></div><TrendChart data={d.dailyTrend || []} /></Panel>
        <Panel className="device-summary-panel"><div className="panel-heading"><div><div className="eyebrow">YOUR SETUP</div><h3>Device status</h3></div><Link href="/devices" className="text-link">Manage <ArrowRight size={14} /></Link></div><div className="device-count"><strong>{d.deviceSummary.total}</strong><span>registered devices</span></div><div className="status-rail"><span style={{ width: `${d.deviceSummary.total ? d.deviceSummary.on / d.deviceSummary.total * 100 : 0}%` }} /></div><div className="status-legend"><span><i className="dot dot-green" />On <b>{d.deviceSummary.on}</b></span><span><i className="dot dot-neutral" />Off <b>{d.deviceSummary.off}</b></span><span><i className="dot dot-muted" />Inactive <b>{d.deviceSummary.inactive}</b></span></div><div className="setup-foot"><span>Automation actions</span><strong>{d.automationActionsCount} <small>this month</small></strong></div></Panel>
      </div>
      <div className="dashboard-grid lower-grid"><Panel><div className="panel-heading"><div><div className="eyebrow">ENERGY BREAKDOWN</div><h3>Top devices today</h3></div><Link href="/usage" className="text-link">Full report <ArrowRight size={14} /></Link></div><DeviceUsageList data={d.deviceUsage || []} /></Panel>
          <Panel className="savings-panel"><div className="savings-top"><div className="eyebrow">MEASURED IMPACT</div><div className="savings-symbol"><ArrowDownRight size={19} /></div></div><h3>Efficiency that<br /><em>shows up.</em></h3><div className="savings-values"><div><strong>{num(d.energySavedKwh, 2)}<small> kWh</small></strong><span>energy saved</span></div><div><strong>{money(d.moneySavedInr)}</strong><span>money saved</span></div></div><div className="savings-rule" /><div className="savings-bottom"><span>Tariff</span>{tariffEdit ? <form className="tariff-edit" onSubmit={e => { e.preventDefault(); const value = Number(tariffValue); if (value > 0) updateTariff.mutate({ data: { tariffInrPerKwh: value } }, { onSuccess: () => { invalidate(qc, [getGetTariffQueryKey(), getGetDashboardQueryKey(), getGetLatestEnergyAnalysisQueryKey(), getListUsageQueryKey(), getListWasteEventsQueryKey(), getListAutomationActionsQueryKey()]); setTariffEdit(false); setToast('Tariff updated. Existing costs now use your current rate.'); }, onError: () => setToast('Tariff could not be updated. Please check the value and retry.') }); }}><TextInput data-testid="input-tariff" type="number" min="0.01" step="0.01" value={tariffValue} onChange={e => setTariffValue(e.target.value)} /><Button type="submit" disabled={updateTariff.isPending}><Check size={14} /></Button><IconButton label="Cancel" onClick={() => setTariffEdit(false)}><X size={14} /></IconButton></form> : <button className="tariff-button" onClick={() => { setTariffValue(String(tariff.data?.tariffInrPerKwh ?? '')); setTariffEdit(true); }}><span>{money(tariff.data?.tariffInrPerKwh || 0)} / kWh</span><Settings2 size={14} /></button>}</div></Panel></div>
      <Panel className="activity-panel"><div className="panel-heading"><div><div className="eyebrow">RECENT SIGNALS</div><h3>Activity worth knowing</h3></div><Link href="/analysis" className="text-link">View waste & analysis <ArrowRight size={14} /></Link></div>{d.recentActivity?.length ? <div className="activity-list">{d.recentActivity.slice(0, 5).map((a, i) => <div className="activity-row" key={`${a.createdAt}-${i}`}><span className={`activity-mark ${a.kind === 'waste' ? 'mark-waste' : 'mark-auto'}`}>{a.kind === 'waste' ? <AlertCircle size={15} /> : <Check size={15} />}</span><div><strong>{a.message}</strong><span>{dateLabel(a.createdAt)}</span></div><StatusPill tone={a.severity}>{a.kind === 'waste' ? 'Waste' : 'Automation'}</StatusPill></div>)}</div> : <Empty title="No activity to review" message="Waste events and automation actions will appear here." />}</Panel>
      {devices.data?.length === 0 && <Panel><Empty title="Start with a device" message="Add the appliances you want to understand. Your energy picture begins there." action={<Link href="/devices" className="btn btn-primary">Add a device <ArrowRight size={15} /></Link>} /></Panel>}</>}
    </QueryState>
  </div>;
}
function MetricCard({ label, value, sub, icon, accent }: { label: string; value: string; sub: string; icon: ReactNode; accent: string }) {
  return <Panel className={`metric-card metric-${accent}`}><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><strong className="metric-value">{value}</strong><span className="metric-sub">{sub}</span></Panel>;
}
function TrendChart({ data }: { data: { date: string; energyKwh: number }[] }) {
  const max = Math.max(...data.map(x => x.energyKwh), 1);
  if (!data.length) return <Empty title="No trend yet" message="Usage records will shape your daily trend." />;
  return <div className="trend-chart"><div className="chart-y"><span>{num(max, 0)} kWh</span><span>{num(max / 2, 0)}</span><span>0</span></div><div className="chart-area"><div className="chart-guides"><i /><i /><i /></div><div className="bar-row">{data.map((v, i) => <div className="bar-column" key={v.date} title={`${num(v.energyKwh, 2)} kWh`}><span className="bar-value">{num(v.energyKwh, 1)}</span><div className={`chart-bar ${i === data.length - 1 ? 'chart-bar-current' : ''}`} style={{ height: `${Math.max(4, v.energyKwh / max * 100)}%` }} /><span className="bar-label">{dayLabel(v.date)}</span></div>)}</div></div></div>;
}
function DeviceUsageList({ data }: { data: { deviceId: number; deviceName: string; energyKwh: number }[] }) {
  const max = Math.max(...data.map(d => d.energyKwh), 1);
  return data.length ? <div className="usage-rank">{data.slice(0, 5).map((d, i) => <div className="rank-row" key={d.deviceId}><span className="rank-number">0{i + 1}</span><div className="rank-body"><div className="rank-label"><strong>{d.deviceName}</strong><span>{num(d.energyKwh, 2)} kWh</span></div><div className="rank-track"><i style={{ width: `${d.energyKwh / max * 100}%` }} /></div></div></div>)}</div> : <Empty title="No usage recorded" message="When your devices report energy use, they’ll appear here." />;
}

function DeviceForm({ initial, onClose }: { initial?: Device; onClose: () => void }) {
  const create = useCreateDevice(); const update = useUpdateDevice(); const qc = useQueryClient();
  const [form, setForm] = useState({ name: initial?.name || '', type: initial?.type || 'AC', ratedPowerW: String(initial?.ratedPowerW ?? 1200), state: initial?.state || 'OFF', thresholdKwh: String(initial?.thresholdKwh ?? 2.5), maxRuntimeMinutes: String(initial?.maxRuntimeMinutes ?? 120), room: initial?.room || '', active: initial?.active ?? true });
  const [formError, setFormError] = useState('');
  const change = (k: keyof typeof form, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));
  const submit = (e: FormEvent) => { e.preventDefault(); setFormError(''); const data = { ...form, ratedPowerW: Number(form.ratedPowerW), thresholdKwh: Number(form.thresholdKwh), maxRuntimeMinutes: Number(form.maxRuntimeMinutes), room: form.room || null } as const;
    const done = () => { invalidate(qc, [getListDevicesQueryKey(), getGetDashboardQueryKey()]); onClose(); };
    const onError = () => setFormError('The device could not be saved. Check the fields and try again.');
    if (initial) update.mutate({ id: initial.id, data }, { onSuccess: done, onError }); else create.mutate({ data }, { onSuccess: done, onError });
  };
  const pending = create.isPending || update.isPending;
  return <Modal title={initial ? 'Edit device' : 'Add a device'} eyebrow="DEVICE DETAILS" close={onClose}><form className="stack-form" onSubmit={submit}>
    {formError && <InlineError>{formError}</InlineError>}
    <Field label="Device name"><TextInput data-testid="input-device-name" value={form.name} required maxLength={80} placeholder="e.g. Living room AC" onChange={e => change('name', e.target.value)} /></Field>
    <div className="form-two"><Field label="Appliance type"><SelectInput value={form.type} onChange={e => change('type', e.target.value)}>{deviceTypes.map(t => <option key={t}>{t}</option>)}</SelectInput></Field><Field label="Room"><TextInput value={form.room} maxLength={80} placeholder="e.g. Meeting room" onChange={e => change('room', e.target.value)} /></Field></div>
    <div className="form-two"><Field label="Rated power (W)"><TextInput type="number" min="1" max="50000" value={form.ratedPowerW} onChange={e => change('ratedPowerW', e.target.value)} required /></Field><Field label="Energy threshold (kWh)"><TextInput type="number" min="0.01" max="1000" step="0.1" value={form.thresholdKwh} onChange={e => change('thresholdKwh', e.target.value)} required /></Field></div>
    <div className="form-two"><Field label="Max runtime (minutes)"><TextInput type="number" min="1" max="1440" value={form.maxRuntimeMinutes} onChange={e => change('maxRuntimeMinutes', e.target.value)} required /></Field><Field label="Current state"><SelectInput value={form.state} onChange={e => change('state', e.target.value)}><option value="OFF">Off</option><option value="ON">On</option></SelectInput></Field></div>
    <label className="check-row"><input type="checkbox" checked={form.active} onChange={e => change('active', e.target.checked)} /> Track this device as active</label>
    <div className="modal-actions"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? 'Saving…' : initial ? 'Save changes' : 'Add device'}</Button></div>
  </form></Modal>;
}
function DevicesPage() {
  const q = useListDevices(); const qc = useQueryClient(); const del = useDeleteDevice(); const update = useUpdateDevice();
  const [modal, setModal] = useState<'new' | Device | null>(null); const [search, setSearch] = useState(''); const [actionError, setActionError] = useState('');
  const data = q.data || [];
  const filtered = data.filter(d => `${d.name} ${d.type} ${d.room || ''}`.toLowerCase().includes(search.toLowerCase()));
  const deleteDevice = (d: Device) => { setActionError(''); if (window.confirm(`Remove ${d.name} and its dependent telemetry?`)) del.mutate({ id: d.id }, { onSuccess: () => invalidate(qc, [getListDevicesQueryKey(), getListUsageQueryKey(), getListAutomationRulesQueryKey(), getListWasteEventsQueryKey(), getListAutomationActionsQueryKey(), getGetDashboardQueryKey(), getGetLatestEnergyAnalysisQueryKey()]), onError: () => setActionError('The device could not be removed. Please try again.') }); };
  const toggle = (d: Device) => { setActionError(''); update.mutate({ id: d.id, data: { state: d.state === 'ON' ? 'OFF' : 'ON' } }, { onSuccess: () => invalidate(qc, [getListDevicesQueryKey(), getGetDashboardQueryKey()]), onError: () => setActionError('The device state could not be changed. Please try again.') }); };
  return <div className="page-stack"><div className="page-heading"><div><div className="eyebrow">YOUR CONNECTED PICTURE</div><h1>Devices</h1><p>Keep your virtual appliances accurate. Their state changes are reflected across your energy picture.</p></div><Button onClick={() => setModal('new')}><Plus size={17} /> Add device</Button></div>
     {actionError && <InlineError>{actionError}</InlineError>}
     <div className="device-overview-row"><div className="device-overview"><div className="overview-icon"><Cpu size={18} /></div><div><strong>{data.length}</strong><span>total devices</span></div></div><div className="device-overview"><div className="overview-icon overview-on"><Power size={18} /></div><div><strong>{data.filter(d => d.state === 'ON' && d.active).length}</strong><span>currently on</span></div></div><div className="device-overview"><div className="overview-icon overview-idle"><Clock3 size={18} /></div><div><strong>{data.filter(d => !d.active).length}</strong><span>inactive</span></div></div><div className="search-wrap"><Search size={16} /><TextInput data-testid="input-device-search" placeholder="Find a device…" value={search} onChange={e => setSearch(e.target.value)} /></div></div>
    <QueryState loading={q.isLoading} error={q.isError} retry={() => void q.refetch()}>{filtered.length ? <div className="devices-grid">{filtered.map(d => <DeviceCard key={d.id} device={d} onEdit={() => setModal(d)} onDelete={() => deleteDevice(d)} onToggle={() => toggle(d)} busy={update.isPending || del.isPending} />)}</div> : <Panel><Empty title={search ? 'No matching devices' : 'A thoughtful setup starts here'} message={search ? 'Try another name, room, or appliance type.' : 'Add the appliances you want to monitor. You can change their state and set useful thresholds at any time.'} action={!search && <Button onClick={() => setModal('new')}><Plus size={16} /> Add your first device</Button>} /></Panel>}</QueryState>
    {modal && <DeviceForm initial={modal === 'new' ? undefined : modal} onClose={() => setModal(null)} />}
  </div>;
}
function DeviceCard({ device: d, onEdit, onDelete, onToggle, busy }: { device: Device; onEdit: () => void; onDelete: () => void; onToggle: () => void; busy: boolean }) {
  return <Panel className={`device-card ${d.state === 'ON' ? 'device-on' : ''}`}><div className="device-card-top"><div className={`device-art ${d.state === 'ON' ? 'art-on' : ''}`}><ApplianceIcon type={d.type} /></div><StatusPill tone={d.state === 'ON' ? 'mint' : 'neutral'}><span className={`mini-dot ${d.state === 'ON' ? 'green' : ''}`} />{d.state === 'ON' ? 'On' : 'Off'}</StatusPill></div><div className="device-title"><div><h3>{d.name}</h3><span>{d.room || 'Room not set'} <b>·</b> {d.type}</span></div><div className={`power-indicator ${d.state === 'ON' ? 'power-on' : ''}`}><Power size={16} /></div></div><div className="device-specs"><div><span>Rated power</span><strong>{num(d.ratedPowerW, 0)} W</strong></div><div><span>Energy limit</span><strong>{num(d.thresholdKwh, 1)} kWh</strong></div><div><span>Runtime cap</span><strong>{d.maxRuntimeMinutes} min</strong></div></div><div className="device-card-footer"><button className="device-toggle" onClick={onToggle} disabled={busy} data-testid={`button-toggle-device-${d.id}`}><Power size={14} />{d.state === 'ON' ? 'Switch off' : 'Switch on'}</button><div className="card-actions"><IconButton label="Edit device" onClick={onEdit}><Settings2 size={16} /></IconButton><IconButton label="Delete device" danger onClick={onDelete}><Trash2 size={16} /></IconButton></div></div></Panel>;
}
function ApplianceIcon({ type }: { type: string }) { return type === 'Washing Machine' ? <WashingMachine size={24} /> : type === 'Light' ? <Lightbulb size={24} /> : type === 'Computer' || type === 'TV' ? <Cpu size={24} /> : <Zap size={24} />; }

function UsagePage() {
  const q = useListUsage(); const devices = useListDevices(); const qc = useQueryClient();
  const create = useCreateUsage(); const update = useUpdateUsage(); const remove = useDeleteUsage();
  const [showCreate, setShowCreate] = useState(false); const [editing, setEditing] = useState<UsageRecord | null>(null); const [period, setPeriod] = useState('all');
  const [actionError, setActionError] = useState('');
  const activeDevices = (devices.data || []).filter(d => d.active);
  const rows = [...(q.data || [])].sort((a, b) => +new Date(b.recordedAt) - +new Date(a.recordedAt));
  const filtered = rows.filter(r => period === 'all' || +new Date(r.recordedAt) >= Date.now() - Number(period) * 86400000);
  const total = filtered.reduce((s, r) => s + r.energyKwh, 0); const cost = filtered.reduce((s, r) => s + r.costInr, 0);
  const usageRelatedKeys = [getListUsageQueryKey(), getListDevicesQueryKey(), getListWasteEventsQueryKey(), getListAutomationActionsQueryKey(), getGetDashboardQueryKey(), getGetLatestEnergyAnalysisQueryKey()];
  const deleteRow = (r: UsageRecord) => { setActionError(''); if (window.confirm(`Delete the usage record for ${r.deviceName}?`)) remove.mutate({ id: r.id }, { onSuccess: () => invalidate(qc, usageRelatedKeys), onError: () => setActionError('The usage record could not be deleted. Please try again.') }); };
  const createRecord = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setActionError(''); const f = new FormData(e.currentTarget); create.mutate({ data: { deviceId: Number(f.get('deviceId')), energyKwh: Number(f.get('energyKwh')), durationMinutes: Number(f.get('durationMinutes')), recordedAt: new Date(String(f.get('recordedAt'))).toISOString() } }, { onSuccess: () => { invalidate(qc, usageRelatedKeys); setShowCreate(false); }, onError: () => setActionError('The usage record could not be saved. Check the values and try again.') }); };
  return <div className="page-stack"><div className="page-heading"><div><div className="eyebrow">MEASURE WHAT MATTERS</div><h1>Energy usage</h1><p>Review the telemetry behind your totals, and follow how consumption changes over time.</p></div><Button onClick={() => setShowCreate(true)}><Plus size={17} /> Add usage record</Button></div>
    {actionError && <InlineError>{actionError}</InlineError>}
    <div className="usage-summary-grid"><div className="usage-summary"><span>Selected period</span><strong>{num(total, 2)} <small>kWh</small></strong><span className="summary-foot">{filtered.length} telemetry records</span></div><div className="usage-summary"><span>Recorded cost</span><strong>{money(cost)}</strong><span className="summary-foot">Priced at your current tariff</span></div><div className="usage-summary"><span>Devices reporting</span><strong>{new Set(filtered.map(x => x.deviceId)).size}</strong><span className="summary-foot">Across selected period</span></div></div>
    <Panel className="usage-trend-panel"><div className="panel-heading"><div><div className="eyebrow">CONSUMPTION TREND</div><h3>Energy records over time</h3></div><SelectInput className="select-compact" aria-label="Choose usage period" value={period} onChange={e => setPeriod(e.target.value)}><option value="all">All records</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></SelectInput></div>
      <UsageChart records={filtered} /></Panel>
    <Panel className="table-panel"><div className="panel-heading"><div><div className="eyebrow">TELEMETRY LOG</div><h3>Usage records <span className="count-badge">{filtered.length}</span></h3></div></div><QueryState loading={q.isLoading} error={q.isError} retry={() => void q.refetch()}>{filtered.length ? <div className="table-scroll"><table><thead><tr><th>Device</th><th>Energy</th><th>Duration</th><th>Cost</th><th>Recorded</th><th>Source</th><th></th></tr></thead><tbody>{filtered.map(r => <tr key={r.id}><td><strong>{r.deviceName}</strong><span className="table-sub">ID {r.deviceId}</span></td><td><span className="mono">{num(r.energyKwh, 3)} kWh</span></td><td>{r.durationMinutes} min</td><td>{money(r.costInr)}</td><td>{dateLabel(r.recordedAt)}</td><td><StatusPill tone={r.simulated ? 'sand' : 'mint'}>{r.simulated ? 'Simulated' : 'Recorded'}</StatusPill></td><td><div className="table-actions"><IconButton label="Edit usage" onClick={() => setEditing(r)}><Settings2 size={15} /></IconButton><IconButton label="Delete usage" danger onClick={() => deleteRow(r)}><Trash2 size={15} /></IconButton></div></td></tr>)}</tbody></table></div> : <Empty title="No usage records yet" message="Add an entry or run a dashboard simulation to see telemetry and trends." action={<Button onClick={() => setShowCreate(true)}><Plus size={15} /> Add record</Button>} />}</QueryState></Panel>
    {showCreate && <Modal title="Add usage record" eyebrow="TELEMETRY" close={() => setShowCreate(false)}><form className="stack-form" onSubmit={createRecord}><Field label="Device"><SelectInput name="deviceId" required defaultValue="">{devices.data?.map(d => <option value={d.id} key={d.id}>{d.name}</option>)}</SelectInput></Field><div className="form-two"><Field label="Energy (kWh)"><TextInput name="energyKwh" type="number" step="0.001" min="0" required /></Field><Field label="Duration (minutes)"><TextInput name="durationMinutes" type="number" min="1" required /></Field></div><Field label="Recorded at"><TextInput name="recordedAt" type="datetime-local" defaultValue={new Date().toISOString().slice(0, 16)} /></Field><div className="modal-actions"><Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button type="submit" disabled={create.isPending || !devices.data?.length}>{create.isPending ? 'Saving…' : 'Save record'}</Button></div></form></Modal>}
    {editing && <Modal title="Edit usage record" eyebrow="TELEMETRY" close={() => setEditing(null)}><form className="stack-form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); update.mutate({ id: editing.id, data: { deviceId: Number(f.get('deviceId')), energyKwh: Number(f.get('energyKwh')), durationMinutes: Number(f.get('durationMinutes')), recordedAt: new Date(String(f.get('recordedAt'))).toISOString() } }, { onSuccess: () => { invalidate(qc, usageRelatedKeys); setEditing(null); } }); }}><Field label="Device"><SelectInput name="deviceId" defaultValue={editing.deviceId}>{devices.data?.map(d => <option value={d.id} key={d.id}>{d.name}</option>)}</SelectInput></Field><div className="form-two"><Field label="Energy (kWh)"><TextInput name="energyKwh" type="number" step="0.001" defaultValue={editing.energyKwh} required /></Field><Field label="Duration (minutes)"><TextInput name="durationMinutes" type="number" defaultValue={editing.durationMinutes} required /></Field></div><Field label="Recorded at"><TextInput name="recordedAt" type="datetime-local" defaultValue={new Date(editing.recordedAt).toISOString().slice(0, 16)} /></Field><div className="modal-actions"><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Save changes'}</Button></div></form></Modal>}
  </div>;
}
function UsageChart({ records }: { records: UsageRecord[] }) {
  const grouped = new Map<string, number>();
  records.forEach(r => { const key = new Date(r.recordedAt).toLocaleDateString('en-CA'); grouped.set(key, (grouped.get(key) || 0) + r.energyKwh); });
  const data = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-10);
  const max = Math.max(...data.map(x => x[1]), 1);
  return data.length ? <div className="usage-chart"><div className="usage-bars">{data.map(([date, kwh]) => <div className="usage-bar-col" key={date}><span>{num(kwh, 1)}</span><i style={{ height: `${Math.max(3, kwh / max * 100)}%` }} /><small>{new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small></div>)}</div></div> : <div className="chart-empty"><BarChart3 size={24} /><span>Once usage is recorded, this chart will make the pattern visible.</span></div>;
}

function RuleForm({ rule, devices, close }: { rule?: AutomationRule; devices: Device[]; close: () => void }) {
  const create = useCreateAutomationRule(); const update = useUpdateAutomationRule(); const qc = useQueryClient();
  const [formError, setFormError] = useState('');
  const [deviceId, setDeviceId] = useState(String(rule?.deviceId || ''));
  const [triggerType, setTrigger] = useState(rule?.triggerType || 'runtime');
  const [threshold, setThreshold] = useState(String(rule?.thresholdValue || '60'));
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const submit = (e: FormEvent) => { e.preventDefault(); setFormError(''); const data = { deviceId: Number(deviceId), triggerType, thresholdValue: Number(threshold), action: 'turn_off' as const, enabled };
    const done = () => { invalidate(qc, [getListAutomationRulesQueryKey(), getGetDashboardQueryKey()]); close(); };
    const onError = () => setFormError('The automation rule could not be saved. Check the values and try again.');
    rule ? update.mutate({ id: rule.id, data }, { onSuccess: done, onError }) : create.mutate({ data }, { onSuccess: done, onError });
  };
  return <Modal title={rule ? 'Edit automation' : 'New automation rule'} eyebrow="AUTOMATION SETUP" close={close}><form className="stack-form" onSubmit={submit}>
    {formError && <InlineError>{formError}</InlineError>}
    <Field label="Apply to device"><SelectInput required value={deviceId} onChange={e => setDeviceId(e.target.value)}><option value="">Choose a device</option>{devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</SelectInput></Field>
    <Field label="When should this rule trigger?"><SelectInput value={triggerType} onChange={e => setTrigger(e.target.value as 'runtime' | 'energy')}><option value="runtime">Runtime exceeds</option><option value="energy">Energy use exceeds</option></SelectInput></Field>
    <Field label={triggerType === 'runtime' ? 'Runtime threshold (minutes)' : 'Energy threshold (kWh)'}><TextInput type="number" min="0.1" step={triggerType === 'runtime' ? '1' : '0.1'} max="10000" required value={threshold} onChange={e => setThreshold(e.target.value)} /></Field>
    <div className="rule-action-preview"><div className="preview-icon"><Power size={17} /></div><div><strong>Then switch off this device</strong><span>Virtual state changes are recorded in action history.</span></div></div>
    <label className="check-row"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Enable this rule immediately</label>
    <div className="modal-actions"><Button variant="outline" onClick={close}>Cancel</Button><Button type="submit" disabled={create.isPending || update.isPending || !devices.length}>{create.isPending || update.isPending ? 'Saving…' : rule ? 'Save rule' : 'Create rule'}</Button></div>
  </form></Modal>;
}
function AutomationPage() {
  const rules = useListAutomationRules(); const actions = useListAutomationActions(); const devices = useListDevices(); const qc = useQueryClient();
  const dashboard = useGetDashboard();
  const toggle = useSetAutomationRuleEnabled(); const remove = useDeleteAutomationRule();
  const [editing, setEditing] = useState<AutomationRule | 'new' | null>(null);
  const [actionError, setActionError] = useState('');
  const setEnabled = (r: AutomationRule) => { setActionError(''); toggle.mutate({ id: r.id, data: { enabled: !r.enabled } }, { onSuccess: () => invalidate(qc, [getListAutomationRulesQueryKey(), getGetDashboardQueryKey()]), onError: () => setActionError('The rule state could not be changed. Please try again.') }); };
  const deleteRule = (r: AutomationRule) => { setActionError(''); if (window.confirm(`Delete the rule for ${r.deviceName}?`)) remove.mutate({ id: r.id }, { onSuccess: () => invalidate(qc, [getListAutomationRulesQueryKey(), getListAutomationActionsQueryKey(), getGetDashboardQueryKey()]), onError: () => setActionError('The automation rule could not be deleted. Please try again.') }); };
  const runningCount = rules.data?.filter(r => r.enabled).length || 0;
  return <div className="page-stack"><div className="page-heading"><div><div className="eyebrow">SMALL RULES, REAL FOLLOW-THROUGH</div><h1>Automation</h1><p>Set a clear threshold. When a virtual device crosses it, SA7 records the action and its measured impact.</p></div><Button onClick={() => setEditing('new')} disabled={!devices.data?.length}><Plus size={17} /> New rule</Button></div>
    {actionError && <InlineError>{actionError}</InlineError>}
    <div className="automation-summary"><div className="auto-summary-mark"><Settings2 size={20} /></div><div className="auto-summary-copy"><strong>{runningCount} active {runningCount === 1 ? 'rule' : 'rules'}</strong><span>Rules monitor device runtime or energy thresholds.</span></div><div className="auto-summary-stat"><strong>{dashboard.data?.automationActionsCount ?? (actions.data?.length || 0)}</strong><span>actions logged</span></div><div className="auto-summary-stat"><strong>{num(dashboard.data?.energySavedKwh ?? (actions.data || []).reduce((s, a) => s + a.energySavedKwh, 0), 2)} <small>kWh</small></strong><span>measured saved</span></div></div>
    <div className="dashboard-grid automation-columns"><Panel className="rules-panel"><div className="panel-heading"><div><div className="eyebrow">YOUR RULES</div><h3>Guardrails</h3></div><StatusPill tone="mint">{runningCount} enabled</StatusPill></div><QueryState loading={rules.isLoading} error={rules.isError} retry={() => void rules.refetch()}>{rules.data?.length ? <div className="rules-list">{rules.data.map(r => <div className="rule-item" key={r.id}><div className="rule-device-icon"><Power size={17} /></div><div className="rule-copy"><strong>{r.deviceName}</strong><span>Switch off when {r.triggerType === 'runtime' ? `runtime exceeds ${r.thresholdValue} min` : `energy use exceeds ${num(r.thresholdValue, 2)} kWh`}</span><small>Created {dateLabel(r.createdAt)}</small></div><div className="rule-controls"><button className={`switch-control ${r.enabled ? 'switch-on' : ''}`} onClick={() => setEnabled(r)} aria-label={r.enabled ? 'Disable rule' : 'Enable rule'} role="switch" aria-checked={r.enabled}><i /></button><IconButton label="Edit rule" onClick={() => setEditing(r)}><Settings2 size={15} /></IconButton><IconButton label="Delete rule" danger onClick={() => deleteRule(r)}><Trash2 size={15} /></IconButton></div></div>)}</div> : <Empty title="No guardrails yet" message="Create a rule to switch a device off when its runtime or energy threshold is reached." action={<Button onClick={() => setEditing('new')} disabled={!devices.data?.length}><Plus size={15} /> Create your first rule</Button>} />}</QueryState></Panel>
      <Panel><div className="panel-heading"><div><div className="eyebrow">HOW IT WORKS</div><h3>A measured response</h3></div><ShieldCheck size={18} className="soft-icon" /></div><div className="steps-list"><div className="step"><span>01</span><div><strong>Choose a device</strong><p>Use a virtual device you’ve already added.</p></div></div><div className="step"><span>02</span><div><strong>Set a threshold</strong><p>Choose a runtime or energy limit that makes sense.</p></div></div><div className="step"><span>03</span><div><strong>See what changed</strong><p>State changes and estimated savings appear in history.</p></div></div></div><div className="rule-footnote"><Lightbulb size={15} /> Automation is simulated and does not control physical appliances.</div></Panel></div>
    <Panel className="table-panel"><div className="panel-heading"><div><div className="eyebrow">EXECUTED ACTIONS</div><h3>Action history <span className="count-badge">{actions.data?.length || 0}</span></h3></div></div><QueryState loading={actions.isLoading} error={actions.isError} retry={() => void actions.refetch()}>{actions.data?.length ? <div className="table-scroll"><table><thead><tr><th>Device</th><th>Trigger</th><th>State change</th><th>Energy saved</th><th>Money saved</th><th>Executed</th></tr></thead><tbody>{[...actions.data].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).map(a => <tr key={a.id}><td><strong>{a.deviceName}</strong><span className="table-sub">Rule #{a.ruleId}</span></td><td>{a.triggerReason}</td><td><span className="state-change">{a.previousState} <ArrowRight size={12} /> {a.newState}</span></td><td className="mono">{num(a.energySavedKwh, 3)} kWh</td><td>{money(a.moneySavedInr)}</td><td>{dateLabel(a.createdAt)}</td></tr>)}</tbody></table></div> : <Empty title="No actions yet" message="When an enabled rule responds to a threshold, you’ll see the decision and its measured impact here." />}</QueryState></Panel>
    {editing && <RuleForm rule={editing === 'new' ? undefined : editing} devices={devices.data || []} close={() => setEditing(null)} />}
  </div>;
}

function AnalysisPage() {
  const waste = useListWasteEvents(); const devices = useListDevices(); const qc = useQueryClient();
  const update = useUpdateWasteStatus(); const analyze = useRunEnergyAnalysis();
  const latest = useGetLatestEnergyAnalysis();
  const analysis = latest.data?.analysis ?? null;
  const [message, setMessage] = useState('');
  const updateStatus = (event: WasteEvent, status: 'resolved' | 'dismissed' | 'open') => update.mutate({ id: event.id, data: { status } }, { onSuccess: () => invalidate(qc, [getListWasteEventsQueryKey(), getGetDashboardQueryKey()]), onError: () => setMessage('The waste event could not be updated. Please try again.') });
  const runAnalysis = () => { setMessage(''); analyze.mutate(undefined, { onSuccess: () => invalidate(qc, [getGetLatestEnergyAnalysisQueryKey()]), onError: () => setMessage('Analysis could not be completed right now. Please try again.') }); };
  const wasteTotal = (waste.data || []).filter(w => w.status === 'open').reduce((s, w) => s + w.wastedKwh, 0);
  return <div className="page-stack"><div className="page-heading"><div><div className="eyebrow">FIND THE FIXABLE MOMENTS</div><h1>Waste & analysis</h1><p>Review measured waste events, decide what’s resolved, and request a focused energy analysis when useful.</p></div><Button onClick={runAnalysis} disabled={analyze.isPending}><Sparkles size={16} />{analyze.isPending ? 'Analyzing…' : 'Run AI Energy Analysis'}</Button></div>
    {message && <div className="form-error"><AlertCircle size={16} />{message}</div>}
    <div className="waste-summary-grid"><div className="waste-summary waste-summary-accent"><div className="waste-summary-icon"><AlertCircle size={18} /></div><div><span>Open waste events</span><strong>{(waste.data || []).filter(w => w.status === 'open').length}</strong></div></div><div className="waste-summary"><div className="waste-summary-icon"><Zap size={18} /></div><div><span>Energy at stake</span><strong>{num(wasteTotal, 2)} <small>kWh</small></strong></div></div><div className="waste-summary"><div className="waste-summary-icon"><ArrowDownRight size={18} /></div><div><span>Potential recovery</span><strong>{money((waste.data || []).filter(w => w.status === 'open').reduce((s, w) => s + w.costInr, 0))}</strong></div></div></div>
     <div className="analysis-grid"><Panel className="analysis-prompt"><div className="analysis-kicker"><Sparkles size={16} /> BACKEND-POWERED ANALYSIS</div><h2>A second look at<br /><em>your energy picture.</em></h2><p>Ask SA7 to examine current telemetry and identify one concrete, measurable opportunity. Results use your account’s energy data.</p><div className="analysis-privacy"><ShieldCheck size={15} /> Analysis runs securely through SA7.</div></Panel>
       <Panel className="analysis-result">{latest.isLoading ? <Skeleton lines={4} /> : latest.isError ? <div className="result-empty"><div className="result-mark"><AlertCircle size={22} /></div><div className="eyebrow">ANALYSIS RESULT</div><h3>Saved analysis unavailable.</h3><p>Run a new analysis to refresh this result.</p></div> : analysis ? <><div className="panel-heading"><div><div className="eyebrow">LATEST FINDING</div><h3>Suggested next step</h3></div><StatusPill tone={analysis.priority}>{analysis.priority} priority</StatusPill></div><div className="finding-callout"><span className="finding-mark"><Lightbulb size={19} /></span><div><strong>{analysis.problemDetected}</strong><p>{analysis.whyItMatters}</p></div></div><div className="recommended-action"><span>RECOMMENDED ACTION</span><p>{analysis.recommendedAction}</p>{analysis.deviceName && <small>Device · {analysis.deviceName}</small>}</div><div className="finding-savings"><div><strong>{num(analysis.estimatedSavingsKwh, 2)} <small>kWh</small></strong><span>estimated energy savings</span></div><div><strong>{money(analysis.estimatedSavingsInr)}</strong><span>estimated cost savings</span></div></div><div className="finding-time">Generated {dateLabel(analysis.createdAt)}</div></> : <div className="result-empty"><div className="result-mark"><Sparkles size={22} /></div><div className="eyebrow">ANALYSIS RESULT</div><h3>Evidence first.<br />Then a useful action.</h3><p>Run an analysis to get a specific finding tied to your recorded energy use.</p></div>}</Panel></div>
    <Panel className="table-panel"><div className="panel-heading"><div><div className="eyebrow">MEASURED WASTE</div><h3>Waste events <span className="count-badge">{waste.data?.length || 0}</span></h3></div></div><QueryState loading={waste.isLoading} error={waste.isError} retry={() => void waste.refetch()}>{waste.data?.length ? <div className="table-scroll"><table><thead><tr><th>Device</th><th>What happened</th><th>Severity</th><th>Energy</th><th>Cost</th><th>Status</th><th>Action</th></tr></thead><tbody>{[...waste.data].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).map(w => <tr key={w.id}><td><strong>{w.deviceName}</strong><span className="table-sub">{dateLabel(w.createdAt)}</span></td><td className="reason-cell">{w.reason}</td><td><StatusPill tone={w.severity}>{w.severity}</StatusPill></td><td className="mono">{num(w.wastedKwh, 3)} kWh</td><td>{money(w.costInr)}</td><td><StatusPill tone={w.status === 'open' ? 'rose' : w.status === 'resolved' ? 'mint' : 'neutral'}>{w.status}</StatusPill></td><td>{w.status === 'open' ? <div className="table-actions"><Button variant="quiet" onClick={() => updateStatus(w, 'resolved')} disabled={update.isPending}><Check size={14} /> Resolve</Button><IconButton label="Dismiss event" onClick={() => updateStatus(w, 'dismissed')}><X size={15} /></IconButton></div> : <button className="reopen-button" onClick={() => updateStatus(w, 'open')}>Reopen</button>}</td></tr>)}</tbody></table></div> : <Empty title="No waste events found" message="SA7 will surface measurable waste as your virtual devices generate usage telemetry." action={<Link href="/devices" className="btn btn-outline">Review devices <ArrowRight size={14} /></Link>} />}</QueryState></Panel>
    {devices.data?.length === 0 && <p className="small-note">Add at least one device to create a useful energy picture for analysis.</p>}
  </div>;
}

function Router() {
  const [path] = useLocation();
  if (path === '/login') return <AuthPage />;
  if (path === '/register') return <AuthPage register />;
  if (['/', '/devices', '/usage', '/automation', '/analysis'].includes(path)) return <ProtectedShell path={path} />;
  return <NotFound />;
}
function App() {
  return <QueryClientProvider client={queryClient}><Router /></QueryClientProvider>;
}
export default App;
