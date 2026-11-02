import ActivityCenter from './ActivityCenter';
import ChatGPTConnection from './ChatGPTConnection';
import ConnectionCenter from './ConnectionCenter';
import EvergreenConnection from './EvergreenConnection';
import ProfileSettings from './ProfileSettings';
import { PinSettings } from './WorkspaceLock';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, CalendarDays, Check, CheckCheck,
  ChevronLeft, ChevronRight, Circle, CircleCheck, Cloud, CloudOff, Copy, Ellipsis,
  FileText, FolderOpen, Inbox, Link2, ListTodo, LoaderCircle, Mic, MoreHorizontal,
  Orbit, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Trash2, Users, X,
} from 'lucide-react';
import type { Connection, Entry, Kind, LocalState } from './types';
import { exportSnapshot, importCopies, newEntry, readState, resolveConflict, saveEntry, subscribe, sync } from './storage';
import { localDate, parseBackup } from '../shared/model.mjs';
import Command from './Command';
import PhoneAccess from './PhoneAccess';
import ComputerControl from './ComputerControl';
import Files from './Files';
import Devices from './Devices';
import Ambient from './Ambient';
import VoiceConnection from './VoiceConnection';
import WhatsApp from './WhatsApp';
import MemoryReviews from './MemoryReviews';
import { useVoice } from './useVoice';
import { ConnectedHome, ConnectedWork, ConnectedLibrary, type WorkspaceAskContext } from './ConnectedWorkspace';

const AgentTownWorld = lazy(() => import('./agent-town/AgentTownWorld'));
type View = 'home' | 'work' | 'library' | 'activity' | 'command' | 'today' | 'inbox' | 'tasks' | 'knowledge' | 'projects' | 'people' | 'settings' | 'whatsapp' | 'files' | 'devices' | 'agent-town';
const navigation: { id: View; label: string; icon: typeof Orbit }[] = [
  { id: 'home', label: 'Home', icon: Orbit },
  { id: 'work', label: 'Work', icon: FolderOpen },
  { id: 'library', label: 'Library', icon: BookOpen },
  { id: 'devices', label: 'Devices', icon: Cloud },
];
const destinations: { id: View; label: string; icon: typeof Orbit }[] = [
  ...navigation,
  { id: 'command', label: 'Command', icon: Sparkles },
  { id: 'activity', label: 'Action centre', icon: Orbit },
  { id: 'today', label: 'Today', icon: Orbit }, { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'tasks', label: 'Tasks', icon: ListTodo }, { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
  { id: 'projects', label: 'Projects', icon: FolderOpen }, { id: 'people', label: 'People', icon: Users },
  { id: 'whatsapp', label: 'WhatsApp', icon: Users },
  { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'agent-town', label: 'Agent Town', icon: Orbit },
];
function parentView(view: View): View {
  if (['today', 'activity', 'inbox'].includes(view)) return 'home';
  if (['tasks', 'projects', 'agent-town'].includes(view)) return 'work';
  if (['knowledge', 'people'].includes(view)) return 'library';
  if (view === 'files') return 'devices';
  return view;
}
function routeProject() { try { return location.hash.startsWith('#/work/') ? decodeURIComponent(location.hash.slice(7)) : null; } catch { return null; } }
const kindNames: Record<Kind, string> = { inbox: 'Thought', task: 'Task', note: 'Note', project: 'Project', person: 'Person' };
const kindIcons: Record<Kind, typeof Orbit> = { inbox: Inbox, task: ListTodo, note: FileText, project: FolderOpen, person: Users };
const descriptions: Record<View, string> = {
  home: 'A little more clarity. A useful next step.',
  work: 'Your projects, with everything in context.',
  library: 'Ideas, sources and people worth remembering.',
  activity: 'Real progress across your devices.',
  command: 'Think together with your JARVIS.',
  today: 'A clear view of what matters next.', inbox: 'A landing place for everything on your mind.',
  tasks: 'Keep promises. Make progress. Leave room to think.', knowledge: 'Useful ideas, kept close and connected.',
  projects: 'Give your work a home and a next step.', people: 'Remember the small things that matter.',
  settings: 'Your data, your connections, your control.',
  whatsapp: 'Stay close to your people.',
  files: 'Files from your connected laptop.',
  devices: 'Your devices, connected through JARVIS.',
  'agent-town': 'A window into your coding projects and their observed activity.',
};
function initialView(): View {
  const value = location.hash.replace('#/', '').split('/')[0];
  return [...destinations.map(n => n.id), 'settings'].includes(value) ? value as View : 'home';
}
function dateLabel(value: string, options?: Intl.DateTimeFormatOptions) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, options ?? { day: 'numeric', month: 'short' });
}
function relative(value: string | null) {
  if (!value) return 'Not yet synced';
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes}m ago` : new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
function download(state: LocalState) {
  const blob = new Blob([JSON.stringify(exportSnapshot(state), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `jarvis-${localDate()}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [view, setView] = useState<View>(initialView);
  const [projectId, setProjectId] = useState<string | null>(routeProject);
  const [askContext, setAskContext] = useState<WorkspaceAskContext | null>(null);
  const [askSession, setAskSession] = useState(0);
  const [profile, setProfile] = useState({ label: 'My personal space', displayName: 'My personal space', addressAs: '' });
  useEffect(() => { let alive = true; const refresh = () => void fetch('/api/profile').then(r => r.ok ? r.json() : null).then(p => { if (alive && p) setProfile(p); }).catch(() => {}); refresh(); const timer = setInterval(refresh, 5000); window.addEventListener('jarvis-profile-updated', refresh); return () => { alive = false; clearInterval(timer); window.removeEventListener('jarvis-profile-updated', refresh); }; }, []);
  const [state, setState] = useState<LocalState | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Entry | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [filter, setFilter] = useState('active');
  const [selectedDate, setSelectedDate] = useState(localDate());
  const [busy, setBusy] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [canInstall, setCanInstall] = useState<any>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const moreNavigation = useRef<HTMLDialogElement>(null);

  async function load() {
    try { setState(await readState()); } catch (e) { setError((e as Error).message); }
  }
  function connectionUpdate(c: Connection, message = '') { setConnection(c); setConnectionMessage(message); }
  async function refresh() { setBusy(true); await sync(connectionUpdate); setBusy(false); }
  useEffect(() => {
    void load(); void sync(connectionUpdate);
    const unsubscribe = subscribe(() => void load());
    const interval = setInterval(() => void sync(connectionUpdate), 15000);
    const online = () => void sync(connectionUpdate);
    const offline = () => setConnection('offline');
    const hash = () => { setView(initialView()); setProjectId(routeProject()); setFilter('active'); setQuery(''); moreNavigation.current?.close(); };
    const visibility = () => { if (document.visibilityState === 'visible') online(); };
    const unavailable = () => setOfflineReady(false);
    const install = (e: Event) => { e.preventDefault(); setCanInstall(e); };
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    window.addEventListener('hashchange', hash); window.addEventListener('keydown', key);
    window.addEventListener('beforeinstallprompt', install); window.addEventListener('offline-unavailable', unavailable);
    document.addEventListener('visibilitychange', visibility);
    if ('serviceWorker' in navigator && import.meta.env.PROD) void navigator.serviceWorker.ready.then(() => setOfflineReady(true));
    return () => {
      unsubscribe(); clearInterval(interval); window.removeEventListener('online', online); window.removeEventListener('offline', offline);
      window.removeEventListener('hashchange', hash); window.removeEventListener('keydown', key);
      window.removeEventListener('beforeinstallprompt', install); window.removeEventListener('offline-unavailable', unavailable);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.has('shareTitle') || params.has('shareText') || params.has('shareUrl')) {
      const record = newEntry('inbox'); record.title = (params.get('shareTitle') || 'Shared thought').slice(0, 200);
      record.body = [params.get('shareText'), params.get('shareUrl')].filter(Boolean).join('\n').slice(0, 50000);
      const link = params.get('shareUrl') ?? '';
      if (/^https?:\/\//i.test(link)) record.sourceUrl = link;
      setEditing(record); history.replaceState(null, '', `${location.pathname}${location.hash}`);
    } else if (params.has('capture')) { setEditing(newEntry()); history.replaceState(null, '', `${location.pathname}${location.hash}`); }
  }, []);

  function go(next: View) { setView(next); setQuery(''); setFilter('active'); location.hash = `/${next}`; }
  async function persist(record: Entry, expectedRev?: number) {
    await saveEntry(record, expectedRev);
    setToast('Saved on this device.');
    void sync(connectionUpdate);
  }
  async function toggle(entry: Entry) {
    try { await persist({ ...entry, status: entry.status === 'done' ? 'open' : 'done' }, entry.rev); }
    catch (e) { setError((e as Error).message); }
  }
  function create(kind: Kind, linkedProjectId?: string) { const entry = newEntry(kind); if (linkedProjectId) entry.projectId = linkedProjectId; setEditing(entry); }
  function selectProject(id: string | null) { setProjectId(id); setView('work'); setQuery(''); location.hash = id ? `/work/${encodeURIComponent(id)}` : '/work'; }
  function openRecord(entry: Entry) { if (entry.kind === 'project' && entry.status !== 'archived') selectProject(entry.id); else setEditing(entry); }
  function ask(context?: WorkspaceAskContext) { if (context) { setAskContext(context); setAskSession(n => n + 1); } go('command'); }
  const all = state?.records.filter(r => !r.deleted) ?? [];
  const active = all.filter(r => r.status !== 'archived');
  const tasks = active.filter(r => r.kind === 'task');
  const openTasks = tasks.filter(r => r.status !== 'done');
  const inbox = active.filter(r => r.kind === 'inbox');
  const projects = active.filter(r => r.kind === 'project' && r.status !== 'done');
  const people = active.filter(r => r.kind === 'person');
  const notes = active.filter(r => r.kind === 'note');
  const pending = state?.outbox.length ?? 0;
  const conflicts = state?.conflicts.length ?? 0;
  const needsAttention = connection === 'error' || connection === 'changed' || conflicts > 0;
  const connectionText = needsAttention ? 'Needs attention' : connection === 'connecting' ? 'Connecting' : connection === 'offline' ? 'Working offline' : pending ? `${pending} waiting to sync` : 'All changes synced';
  const q = query.trim().toLowerCase();
  const results = q ? all.filter(r => [r.title, r.body, ...r.tags, all.find(x => x.id === r.projectId)?.title, all.find(x => x.id === r.personId)?.title].filter(Boolean).join(' ').toLowerCase().includes(q)) : [];
  const focus = openTasks.filter(r => r.status !== 'waiting' && (!r.dueDate || r.dueDate <= selectedDate)).sort((a, b) => Number(b.priority === 'high') - Number(a.priority === 'high') || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const greeting = new Date().getHours() < 12 ? 'Good morning.' : new Date().getHours() < 18 ? 'Good afternoon.' : 'Good evening.';
  const viewKind: Partial<Record<View, Kind>> = { inbox: 'inbox', tasks: 'task', knowledge: 'note', projects: 'project', people: 'person' };
  const visible = all.filter(r => r.kind === viewKind[view]).filter(r => filter === 'archived' ? r.status === 'archived' : filter === 'done' ? r.status === 'done' : filter === 'waiting' ? r.status === 'waiting' : r.status !== 'archived' && (view !== 'tasks' || r.status !== 'done'))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const counts: Partial<Record<View, number>> = { inbox: inbox.length, tasks: openTasks.length };

  const section = parentView(view);
  const sectionLinks: View[] = section === 'home' ? ['home', 'today', 'inbox', 'activity'] : section === 'work' ? ['work', 'tasks', 'projects', 'agent-town'] : section === 'library' ? ['library', 'knowledge', 'people'] : section === 'devices' ? ['devices', 'files'] : [];
  return <div className={`app-shell connected-shell view-${view}`}>
    <Ambient />
    <a className="skip-link" href="#main">Skip to content</a>
    <aside className="sidebar" aria-label="Workspace dock">
      <nav aria-label="Main navigation">{navigation.map(({ id, label, icon: Icon }) => <a key={id} aria-label={label} href={`#/${id}`} className={`nav-item ${section === id && !q ? 'selected' : ''}`} aria-current={section === id && !q ? 'page' : undefined} onClick={() => { setQuery(''); setFilter('active'); }}><Icon size={19} strokeWidth={1.7} /><span>{label}</span></a>)}<button className={`nav-item mobile-more ${['command', 'whatsapp', 'settings'].includes(view) ? 'selected' : ''}`} aria-haspopup="dialog" onClick={() => moreNavigation.current?.showModal()}><Ellipsis size={20} /><span>More</span></button></nav>
      <nav className="connected-shortcuts" aria-label="Quick access"><a className={`nav-item ${view === 'command' ? 'selected' : ''}`} href="#/command"><Sparkles size={18} /><span>Ask JARVIS</span></a><a className={`nav-item ${view === 'whatsapp' ? 'selected' : ''}`} href="#/whatsapp"><Users size={18} /><span>WhatsApp</span></a><button className="nav-item" onClick={() => moreNavigation.current?.showModal()} aria-haspopup="dialog"><Ellipsis size={18} /><span>All tools</span></button></nav>
    </aside>

    <div className="workspace">
      <header className="topbar"><div className="shell-location"><a className="brand" href="#/home" aria-label="JARVIS home"><Orbit size={23} strokeWidth={1.5} /><span>JARVIS</span></a><span className="breadcrumb"><ChevronRight size={13} /><strong>{q ? 'Search' : view === 'settings' ? 'Settings' : destinations.find(n => n.id === view)?.label}</strong></span></div>
        <div className="topbar-actions"><div className="search-field"><Search size={17} /><input ref={searchRef} aria-label="Search your JARVIS" placeholder="Search saved items…" value={query} onChange={e => setQuery(e.target.value)} />{query ? <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button> : <kbd>Ctrl K</kbd>}</div><button className="shell-capture" aria-label="Capture a thought" onClick={() => create('inbox')}><Plus size={17} /><span>Capture</span></button><button className="sync-pill" onClick={() => { location.hash = '/settings/data'; }} title={connectionText}>{connection === 'offline' ? <CloudOff size={15} /> : <Cloud size={15} />}<span>{connection === 'online' && !pending && !needsAttention ? 'Synced' : connectionText}</span></button><a className="shell-profile" href="#/settings" aria-label="Settings and connections" title={`${profile.label} · Settings & connections`}><span>{profile.displayName[0]}</span><Settings2 size={15} />{needsAttention && <i className="attention-dot" />}</a></div>
      </header>
      <main id="main" tabIndex={-1}>
        {!q && !!sectionLinks.length && <nav className="connected-section-nav" aria-label="Section navigation">{sectionLinks.map(id => <a key={id} aria-label={id === section ? 'Overview' : destinations.find(n => n.id === id)?.label} href={`#/${id}`} aria-current={view === id ? 'page' : undefined}>{id === section ? 'Overview' : destinations.find(n => n.id === id)?.label}{!!counts[id] && <span>{counts[id]}</span>}</a>)}</nav>}
        {error && <div className="banner error" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={17} /></button></div>}
        {(connection === 'offline' || needsAttention) && <div className={`banner ${needsAttention ? 'warning' : ''}`}><span>{connection === 'changed' ? connectionMessage : conflicts ? `${conflicts} item${conflicts === 1 ? '' : 's'} changed in two places. Both versions are kept for review.` : connection === 'error' ? connectionMessage : 'Your computer is unavailable. Keep capturing—saved changes will sync when it reconnects.'}</span><button className="text-button" onClick={() => needsAttention ? go('settings') : void refresh()}>{needsAttention ? 'Review' : 'Retry'}</button></div>}
        {!state ? <div className="loading"><LoaderCircle className="spin" /> Opening your space…</div> : q ? <>
          <div className="page-heading"><div><p className="overline">Your saved items</p><h1>Find your way back.</h1><p>{results.length} result{results.length === 1 ? '' : 's'} for “{query}”</p><p className="form-hint">Searches saved notes, tasks, projects and people. Device files, chats and coding sessions are available in their own tools.</p></div></div>
          {results.length ? <div className="list-panel">{results.map(r => <ItemRow key={r.id} entry={r} all={all} onOpen={openRecord} onToggle={toggle} showKind />)}</div> : <Empty icon={Search} title="Nothing here just yet" text="Try a name, a phrase, or a tag. Search looks through your titles, notes, and linked people and projects." />}
        </> : view === 'home' ? <><ConnectedHome records={all} name={profile.addressAs || profile.displayName} onOpen={openRecord} onCreate={create} onToggle={toggle} onAsk={ask} onSelectProject={selectProject} /><ActivityCenter compact key={state.serverId} workspace={state.serverId || 'local'} /></> : view === 'work' ? <ConnectedWork records={all} projectId={projectId} onSelectProject={selectProject} onOpen={setEditing} onCreate={create} onToggle={toggle} onAsk={ask} /> : view === 'library' ? <ConnectedLibrary records={all} onOpen={openRecord} onCreate={create} onToggle={toggle} onAsk={ask} /> : view === 'agent-town' ? <Suspense fallback={<p role="status">Opening Agent Town…</p>}><AgentTownWorld key={state.serverId} workspaceId={state.serverId || ''} /></Suspense> : view === 'activity' ? <ActivityCenter key={state.serverId} workspace={state.serverId||'local'} /> : view === 'devices' ? <Devices key={state.serverId} /> : view === 'files' ? <Files key={state.serverId} /> : view === 'command' ? <Command key={`${state.serverId}:${askSession}`} context={askContext || undefined} onClearContext={() => setAskContext(null)} addressAs={profile.addressAs} state={state} suspended={!!editing} onOpen={setEditing} onDraft={(text, kind = 'note') => { const entry = newEntry(kind); entry.title = 'From my conversation'; entry.body = text.slice(0, 50000); setEditing(entry); }} /> : view === 'whatsapp' ? <WhatsApp /> : view === 'today' ? <>
          <div className="page-heading today-heading"><div><p className="overline">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>{greeting}</h1><p>{openTasks.length ? `You have ${openTasks.length} open task${openTasks.length === 1 ? '' : 's'}. Let's make a little progress.` : 'A clear mind starts with a place to put things.'}</p></div><div className="orbit-art" aria-hidden="true"><div className="orbit-ring one" /><div className="orbit-ring two" /><div className="orbit-ring three" /><span /><i /></div></div>
          <div className="today-layout"><div className="day-main">
            <QuickCapture onSave={persist} onExpand={() => create('inbox')} />
            <section className="focus-section"><div className="section-heading"><h2>Your focus</h2><button className="text-button" onClick={() => go('tasks')}>All tasks <ArrowRight size={15} /></button></div>
              <WeekStrip selected={selectedDate} onSelect={setSelectedDate} />
              <div className="focus-panel"><div className="panel-label"><span>{selectedDate === localDate() ? 'Today' : dateLabel(selectedDate, { weekday: 'long', day: 'numeric', month: 'short' })}</span><span>{focus.length} to do</span></div>
                {focus.length ? focus.slice(0, 6).map(r => <ItemRow key={r.id} entry={r} all={all} onOpen={setEditing} onToggle={toggle} />) : <div className="focus-empty"><span className="empty-orbit"><CircleCheck size={30} strokeWidth={1.3} /></span><h3>A little breathing room.</h3><p>Add a next step, big or small.<br />It all starts with getting it out of your head.</p></div>}
                <button className="add-row" onClick={() => { const e = newEntry('task'); e.dueDate = selectedDate; setEditing(e); }}><Plus size={17} /> Add a task for this day</button>
              </div>
            </section>
            <section><div className="section-heading"><h2>Recently remembered</h2><button className="text-button" onClick={() => go('knowledge')}>Your knowledge <ArrowRight size={15} /></button></div>{notes.length ? <div className="recent-grid">{notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 2).map(r => <NoteCard key={r.id} entry={r} onOpen={setEditing} />)}</div> : <div className="quiet-empty"><BookOpen size={23} strokeWidth={1.4} /><div><strong>Give a good idea somewhere to live.</strong><p>Save a note, a useful link, or something you learned.</p></div><button className="icon-button" aria-label="Add your first note" onClick={() => create('note')}><Plus size={20} /></button></div>}</section>
          </div><aside className="day-rail">
            <section className="overview-panel"><div className="section-heading"><h2>At a glance</h2><span className="live-dot" /></div><button onClick={() => go('inbox')}><span><Inbox size={18} /> To sort</span><strong>{inbox.length}</strong></button><button onClick={() => { go('tasks'); setTimeout(() => setFilter('waiting'), 0); }}><span><Circle size={18} /> Waiting on</span><strong>{openTasks.filter(r => r.status === 'waiting').length}</strong></button><button onClick={() => { go('tasks'); setTimeout(() => setFilter('done'), 0); }}><span><CheckCheck size={18} /> Completed</span><strong>{tasks.filter(r => r.status === 'done').length}</strong></button></section>
            <section className="rail-projects"><div className="section-heading"><h2>In motion</h2><button className="icon-button" aria-label="Add project" onClick={() => create('project')}><Plus size={17} /></button></div>{projects.length ? projects.slice(0, 4).map((r, i) => <button className="project-mini" key={r.id} onClick={() => setEditing(r)}><span className={`project-glyph color-${i % 3}`}><FolderOpen size={18} /></span><span><strong>{r.title}</strong><small>{openTasks.filter(t => t.projectId === r.id).length} open tasks</small></span><ChevronRight size={15} /></button>) : <p className="muted rail-copy">From Evergreen to your next idea. Keep each project connected to its tasks and notes.</p>}{!projects.length && <button className="text-button" onClick={() => create('project')}>Create a project <ArrowRight size={15} /></button>}</section>
            <section className="continuity-card"><span className="continuity-icon"><Cloud size={23} strokeWidth={1.5} /></span><h3>Pick up where you left off.</h3><p>{pending ? `${pending} change${pending === 1 ? '' : 's'} saved here, waiting for your computer.` : 'Your saved thoughts and tasks are ready when you return.'}</p><div className="continuity-status"><span className={`status-dot ${connection === 'online' ? 'online' : ''}`} />{connectionText}</div><button className="text-button" onClick={() => go('settings')}>Storage & recovery <ArrowUpRight size={14} /></button></section>
            <div className="gentle-note"><Sparkles size={16} /><p>You don't have to hold it all in your head.</p></div>
          </aside></div>
        </> : view === 'settings' ? <Settings state={state} connection={connection} connectionMessage={connectionMessage} offlineReady={offlineReady} busy={busy} onRefresh={refresh} onError={setError} onToast={setToast} onOpen={setEditing} onSave={persist} canInstall={canInstall} onInstall={async () => { await canInstall?.prompt(); setCanInstall(null); }} /> : <>
          <div className="page-heading"><div><p className="overline">Your space</p><h1>{destinations.find(n => n.id === view)?.label}</h1><p>{descriptions[view]}</p></div><button className="primary-button" onClick={() => create(viewKind[view]!)}><Plus size={17} />{view === 'inbox' ? 'Capture a thought' : `Add ${kindNames[viewKind[view]!].toLowerCase()}`}</button></div>
          {viewKind[view] && <MemoryReviews records={all} kind={viewKind[view]} onOpen={setEditing} onSaved={() => void refresh()} />}
          <div className="view-toolbar"><div className="segmented" aria-label="Filter items">{[['active', view === 'tasks' ? 'To do' : 'Active'], ...(view === 'tasks' ? [['waiting', 'Waiting'], ['done', 'Completed']] : []), ['archived', 'Archived']].map(([id, label]) => <button key={id} className={filter === id ? 'active' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div><span className="result-count">{visible.length} item{visible.length === 1 ? '' : 's'}</span></div>
          {visible.length ? view === 'knowledge' ? <div className="note-grid">{visible.map(r => <NoteCard key={r.id} entry={r} onOpen={setEditing} />)}</div> : view === 'projects' ? <div className="project-grid">{visible.map((r, i) => <ProjectCard key={r.id} entry={r} index={i} tasks={tasks.filter(t => t.projectId === r.id)} onOpen={openRecord} />)}</div> : view === 'people' ? <div className="people-grid">{visible.map(r => <button className="person-card" key={r.id} onClick={() => setEditing(r)}><span className="person-avatar">{r.title.split(' ').map(x => x[0]).slice(0, 2).join('')}</span><span><h3>{r.title}</h3><p>{r.tags.join(', ') || 'Someone worth remembering'}</p>{r.birthday && <small><CalendarDays size={13} /> {dateLabel(r.birthday, { day: 'numeric', month: 'long' })}</small>}</span><ChevronRight size={17} /></button>)}</div> : <div className="list-panel">{visible.map(r => <ItemRow key={r.id} entry={r} all={all} onOpen={setEditing} onToggle={toggle} />)}</div> : <Empty icon={view === 'inbox' ? Inbox : kindIcons[viewKind[view]!]} title={filter === 'archived' ? 'Nothing archived' : filter === 'done' ? 'Progress will show up here' : filter === 'waiting' ? 'Nothing waiting on someone else' : ({ inbox: 'Start with whatever is on your mind.', tasks: 'One small next step.', knowledge: 'Make room for what you learn.', projects: 'Bring your work together.', people: 'Keep your people close.' } as Record<string, string>)[view]} text={filter !== 'active' ? 'Your items will appear here when their status changes.' : ({ inbox: 'A thought, a link, a promise. Capture it now and decide where it belongs later.', tasks: 'Add something you want to do. Connect it to a project or a person whenever that helps.', knowledge: 'Save useful information with its source, your own notes, and a few tags.', projects: 'Add a project, then connect its tasks and notes so everything stays in context.', people: 'Remember important dates, conversations, and the things you want to follow up on.' } as Record<string, string>)[view]} action={filter === 'active' ? <button className="primary-button" onClick={() => create(viewKind[view]!)}><Plus size={17} />{view === 'inbox' ? 'Capture your first thought' : `Add your first ${kindNames[viewKind[view]!].toLowerCase()}`}</button> : undefined} />}
        </>}
        <footer className="page-footer"><span><Orbit size={13} /> A home for your thoughts.</span><span>Personal space · {offlineReady ? 'Offline app ready' : 'Device storage enabled'}</span></footer>
      </main>
    </div>
    <dialog ref={moreNavigation} className="navigation-dialog" aria-labelledby="navigation-heading" onClick={e => { if (e.target === e.currentTarget) moreNavigation.current?.close(); }}><div className="dialog-heading"><div><p className="overline">Your workspace</p><h2 id="navigation-heading">Explore JARVIS</h2></div><button className="icon-button" aria-label="Close navigation" onClick={() => moreNavigation.current?.close()}><X size={20} /></button></div><nav aria-label="More navigation">{destinations.map(({ id, label, icon: Icon }) => <a key={id} href={`#/${id}`} onClick={() => moreNavigation.current?.close()}><Icon size={21} /><span>{label}</span><ChevronRight size={16} /></a>)}<a href="#/settings" aria-label="Settings and connections" onClick={() => moreNavigation.current?.close()}><Settings2 size={21} /><span>Settings & connections</span><ChevronRight size={16} /></a></nav><WorkspaceSwitcher /></dialog>
    {editing && <EntryEditor entry={editing} records={all} onClose={() => setEditing(null)} onSave={persist} onOpen={setEditing} />}
    {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
  </div>;
}

function Empty({ icon: Icon, title, text, action }: { icon: typeof Orbit; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-illustration"><span /><Icon size={36} strokeWidth={1.2} /><i /></div><h2>{title}</h2><p>{text}</p>{action}</div>;
}
function ItemRow({ entry, all, onOpen, onToggle, showKind = false }: { entry: Entry; all: Entry[]; onOpen: (r: Entry) => void; onToggle: (r: Entry) => void; showKind?: boolean }) {
  const Icon = kindIcons[entry.kind];
  const linked = all.find(r => r.id === entry.projectId)?.title || all.find(r => r.id === entry.personId)?.title;
  return <div className={`item-row ${entry.status === 'done' ? 'completed' : ''}`}>
    {entry.kind === 'task' ? <button className={`task-check ${entry.status === 'done' ? 'checked' : ''}`} aria-label={entry.status === 'done' ? `Reopen ${entry.title}` : `Complete ${entry.title}`} onClick={() => onToggle(entry)}>{entry.status === 'done' && <Check size={13} />}</button> : <span className="row-icon"><Icon size={19} strokeWidth={1.6} /></span>}
    <button className="item-open" onClick={() => onOpen(entry)}><span className="item-title">{entry.title}</span><span className="item-context">{showKind && <span>{kindNames[entry.kind]}</span>}{linked && <span><FolderOpen size={12} />{linked}</span>}{entry.status === 'waiting' && <span>Waiting on</span>}{entry.tags.slice(0, 2).map(t => <span key={t}>#{t}</span>)}</span></button>
    {entry.priority === 'high' && entry.status !== 'done' && <span className="priority-label">Priority</span>}
    {entry.dueDate && <span className={`due-label ${entry.dueDate < localDate() && entry.status !== 'done' ? 'overdue' : ''}`}>{entry.dueDate === localDate() ? 'Today' : dateLabel(entry.dueDate)}</span>}
    <button className="icon-button row-more" aria-label={`Edit ${entry.title}`} onClick={() => onOpen(entry)}><MoreHorizontal size={17} /></button>
  </div>;
}
function NoteCard({ entry, onOpen }: { entry: Entry; onOpen: (r: Entry) => void }) {
  return <button className="note-card" onClick={() => onOpen(entry)}><span className="note-card-top"><FileText size={19} strokeWidth={1.5} /><span>{dateLabel(localDate(new Date(entry.createdAt)))}</span></span><h3>{entry.title}</h3><p>{entry.body || 'Open this note to add your thoughts.'}</p><span className="note-card-bottom"><span>{entry.tags.slice(0, 2).map(t => <span className="tag" key={t}>{t}</span>)}</span>{entry.sourceUrl && <Link2 size={15} />}</span></button>;
}
function ProjectCard({ entry, index, tasks, onOpen }: { entry: Entry; index: number; tasks: Entry[]; onOpen: (r: Entry) => void }) {
  const done = tasks.filter(t => t.status === 'done').length;
  return <button className="project-card" onClick={() => onOpen(entry)}><span className="project-top"><span className={`project-glyph color-${index % 3}`}><FolderOpen size={23} /></span><ArrowUpRight size={18} /></span><h3>{entry.title}</h3><p>{entry.body || 'Connect your tasks and notes to this project.'}</p><div className="project-progress"><span>{tasks.length ? `${done} of ${tasks.length} tasks complete` : 'Ready for a first step'}</span>{!!tasks.length && <strong>{Math.round(done / tasks.length * 100)}%</strong>}</div><div className="progress-track"><span style={{ width: `${tasks.length ? done / tasks.length * 100 : 0}%` }} /></div></button>;
}
function WeekStrip({ selected, onSelect }: { selected: string; onSelect: (d: string) => void }) {
  const current = new Date(`${selected}T12:00:00`); const monday = new Date(current); monday.setDate(current.getDate() - (current.getDay() + 6) % 7);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return d; });
  function shift(by: number) { const d = new Date(current); d.setDate(d.getDate() + by); onSelect(localDate(d)); }
  return <div className="week-strip"><button className="icon-button" aria-label="Previous week" onClick={() => shift(-7)}><ChevronLeft size={16} /></button>{days.map(d => <button key={localDate(d)} className={`day ${localDate(d) === selected ? 'chosen' : ''} ${localDate(d) === localDate() ? 'is-today' : ''}`} aria-label={d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} aria-pressed={localDate(d) === selected} onClick={() => onSelect(localDate(d))}><span>{d.toLocaleDateString(undefined, { weekday: 'short' })}</span><strong>{d.getDate()}</strong><i /></button>)}<button className="icon-button" aria-label="Next week" onClick={() => shift(7)}><ChevronRight size={16} /></button></div>;
}

function QuickCapture({ onSave, onExpand }: { onSave: (r: Entry) => Promise<void>; onExpand: () => void }) {
  const [text, setText] = useState(() => { try { return localStorage.getItem('brain-capture-draft') || ''; } catch { return ''; } });
  const [kind, setKind] = useState<Kind>('inbox'); const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const voice = useVoice(setText);
  const listening = voice.listening;
  useEffect(() => { try { localStorage.setItem('brain-capture-draft', text); } catch { /* Main records use transactional IndexedDB; this is only a draft. */ } }, [text]);
  async function save(e?: FormEvent) {
    e?.preventDefault(); if (!text.trim() || saving) return;
    setSaving(true); setError('');
    const entry = newEntry(kind); const lines = text.trim().split('\n');
    entry.title = lines[0].slice(0, 200); entry.body = lines[0].length > 200 ? text.trim() : lines.slice(1).join('\n');
    try {
      if (/^https?:\/\/\S+$/.test(text.trim())) {
        let url: URL;
        try { url = new URL(text.trim()); } catch { throw new Error('That link looks incomplete. Add the full address, or capture it as part of a note.'); }
        entry.sourceUrl = url.href; entry.title = url.hostname; entry.body = text.trim();
      }
      await onSave(entry); setText('');
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  function dictate() { voice.clearError(); void voice.startListening(text); }
  return <form className="quick-capture" onSubmit={save}><div className="capture-title"><span><Sparkles size={17} /> What's on your mind?</span><button type="button" className="icon-button" aria-label="Open detailed capture" onClick={onExpand}><ArrowUpRight size={16} /></button></div><textarea aria-label="Quick capture" placeholder="An idea, a to-do, a link you don't want to lose…" value={text} onChange={e => { voice.stopListening(); setText(e.target.value); }} maxLength={50000} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void save(e); }} /><div className="capture-bottom"><div className="capture-type"><select aria-label="Capture type" value={kind} onChange={e => setKind(e.target.value as Kind)}><option value="inbox">Inbox</option><option value="task">Task</option><option value="note">Note</option></select><button type="button" className={`icon-button ${listening ? 'recording' : ''}`} aria-label={listening ? 'Stop dictation' : 'Dictate a thought'} title="Uses local Whisper" disabled={voice.preparing || voice.transcribing || saving} onClick={dictate}><Mic size={17} /></button></div><button className="primary-button small" disabled={!text.trim() || saving}>{saving ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}Save thought</button></div>{listening && <p className="form-hint" role="status">Listening with local Whisper…</p>}{(error || voice.voiceError) && <p className="form-error" role="alert">{error || voice.voiceError}</p>}</form>;
}

function EntryEditor({ entry, records, onClose, onSave, onOpen }: { entry: Entry; records: Entry[]; onClose: () => void; onSave: (r: Entry, rev?: number) => Promise<void>; onOpen: (r: Entry) => void }) {
  const [draft, setDraft] = useState<Entry>({ ...entry }); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const [tags, setTags] = useState(entry.tags.join(', ')); const dialog = useRef<HTMLDialogElement>(null);
  const [aliases, setAliases] = useState((entry.aliases || []).join(', '));
  useEffect(() => setAliases((entry.aliases || []).join(', ')), [entry]);
  useEffect(() => { setDraft({ ...entry }); setTags(entry.tags.join(', ')); setError(''); }, [entry]);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const dirty = JSON.stringify(draft) !== JSON.stringify(entry) || tags !== entry.tags.join(', ') || aliases !== (entry.aliases || []).join(', ');
  const related = records.filter(r => r.id !== entry.id && (r.projectId === entry.id || r.personId === entry.id));
  function close() { if (!dirty || window.confirm('Discard the changes in this editor?')) onClose(); }
  async function save(e: FormEvent) {
    e.preventDefault(); setError(''); setSaving(true);
    try { await onSave({ ...draft, ...(draft.kind === 'person' ? { aliases: aliases.split(',').map(t => t.trim()).filter(Boolean) } : {}), tags: tags.split(',').map(t => t.trim()).filter(Boolean) }, entry.rev); onClose(); }
    catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  async function remove() {
    if (!window.confirm(`Move “${entry.title}” to Trash? You can restore it in Settings.`)) return;
    setSaving(true);
    try { await onSave({ ...entry, deleted: true }, entry.rev); onClose(); } catch (e) { setError((e as Error).message); setSaving(false); }
  }
  function field<K extends keyof Entry>(key: K, value: Entry[K]) { setDraft(d => ({ ...d, [key]: value })); }
  return <dialog ref={dialog} className="editor-dialog" aria-labelledby="editor-heading" onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) close(); }}><form onSubmit={save}>
    <div className="editor-header"><span><span className="editor-icon"><FileText size={18} /></span><h2 id="editor-heading">{entry.rev ? 'Edit' : 'New'} {kindNames[draft.kind].toLowerCase()}</h2></span><button type="button" className="icon-button" aria-label="Close editor" onClick={close}><X size={20} /></button></div>
    <div className="editor-content"><div className="editor-writing"><label className="field-label" htmlFor="item-title">{draft.kind === 'person' ? 'Name' : 'Title'}</label><input id="item-title" className="title-input" autoFocus required maxLength={200} placeholder={draft.kind === 'person' ? 'Who would you like to remember?' : 'Give it a name…'} value={draft.title} onChange={e => field('title', e.target.value)} /><label className="field-label" htmlFor="item-body">{draft.kind === 'person' ? 'Things to remember' : 'Notes'}</label><textarea id="item-body" className="body-input" maxLength={50000} placeholder={draft.kind === 'person' ? 'Conversations, preferences, and things to follow up on…' : 'Add the details, your thinking, or a next step…'} value={draft.body} onChange={e => field('body', e.target.value)} />
        <label className="field-label" htmlFor="source-link">Source link</label><div className="source-field"><Link2 size={16} /><input id="source-link" type="url" maxLength={2048} placeholder="https://…" value={draft.sourceUrl} onChange={e => field('sourceUrl', e.target.value)} />{entry.sourceUrl && <a className="icon-button" href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label="Open source"><ArrowUpRight size={16} /></a>}</div>
        {!!related.length && <div className="related"><h3>Connected to this {kindNames[entry.kind].toLowerCase()}</h3>{related.map(r => <button type="button" key={r.id} onClick={() => { if (!dirty || window.confirm('Discard these edits and open the connected item?')) onOpen(r); }}><span>{kindNames[r.kind]}</span>{r.title}<ChevronRight size={14} /></button>)}</div>}
      </div><aside className="editor-fields"><label>Save as<select value={draft.kind} onChange={e => field('kind', e.target.value as Kind)}>{Object.entries(kindNames).map(([id, label]) => <option key={id} value={id}>{id === 'inbox' ? 'Inbox thought' : label}</option>)}</select></label><label>Status<select aria-label="Status" value={draft.status} onChange={e => field('status', e.target.value as Entry['status'])}><option value="open">Active</option><option value="waiting">Waiting on</option><option value="done">Completed</option><option value="archived">Archived</option></select></label>
        {draft.kind === 'task' && <label>Priority<select value={draft.priority} onChange={e => field('priority', e.target.value as Entry['priority'])}><option value="normal">Normal</option><option value="high">High priority</option></select></label>}
        {draft.kind !== 'person' && <label>Due date<input type="date" value={draft.dueDate} onChange={e => field('dueDate', e.target.value)} /></label>}
        {draft.kind === 'person' && <label>Birthday<input type="date" value={draft.birthday} onChange={e => field('birthday', e.target.value)} /><small>Used as a reference date. Notifications are not enabled yet.</small></label>}
        {draft.kind === 'person' && <><label>Relationship<input aria-label="Relationship" maxLength={100} placeholder="friend, sibling, colleague…" value={draft.relationship || ''} onChange={e => field('relationship', e.target.value)} /></label><label>Names and WhatsApp aliases<input aria-label="Names and WhatsApp aliases" maxLength={2000} placeholder="Partner, Alex, my girlfriend" value={aliases} onChange={e => setAliases(e.target.value)} /><small>Separate names with commas. Exact unique matches are used; ambiguous names need clarification.</small></label><label>WhatsApp contact name<input aria-label="WhatsApp contact name" maxLength={200} placeholder="Exact name as saved in WhatsApp" value={draft.whatsappName || ''} onChange={e => field('whatsappName', e.target.value)} /><small>When set, this exact name is used on the account you choose. It prevents matching a different chat with the same real name.</small></label></>}
        <label className="recall-choice"><span><input type="checkbox" checked={draft.recall === true} onChange={e => field('recall', e.target.checked)} /> Recall when relevant</span><small>Allow matching details to be shared with your connected model in later conversations. Turn off to keep this item manual.</small></label>
        {draft.kind !== 'project' && <label>Project<select aria-label="Project" value={draft.projectId} onChange={e => field('projectId', e.target.value)}><option value="">No project</option>{records.filter(r => r.kind === 'project' && r.id !== draft.id).map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>}
        {draft.kind !== 'person' && <label>Person<select aria-label="Person" value={draft.personId} onChange={e => field('personId', e.target.value)}><option value="">No person</option>{records.filter(r => r.kind === 'person' && r.id !== draft.id).map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>}
        <label>Tags<input placeholder="work, idea, family" maxLength={500} value={tags} onChange={e => setTags(e.target.value)} /><small>Separate tags with commas.</small></label>{entry.rev > 0 && <p className="edited-at">Updated {relative(entry.updatedAt)}</p>}
      </aside></div>
    {error && <div className="editor-error form-error" role="alert">{error}</div>}
    <div className="editor-footer"><div>{entry.rev > 0 && <button type="button" className="text-button danger" onClick={remove} disabled={saving}><Trash2 size={15} />Trash</button>}</div><span className="save-caption">Saved locally first.</span><button type="button" className="secondary-button" onClick={close}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}Save {kindNames[draft.kind].toLowerCase()}</button></div>
  </form></dialog>;
}

const settingsSections = [
    { id: 'connections', label: 'Connections', icon: Link2, description: 'Your services, with a clear view of what is ready.' },
    { id: 'assistant', label: 'Voice & AI', icon: Sparkles, description: 'Choose how JARVIS thinks, listens and speaks.' },
    { id: 'devices', label: 'Devices', icon: Cloud, description: 'Your laptop and phone, working together.' },
    { id: 'personal', label: 'Personal', icon: Users, description: 'Make this space yours. Manage your profile and workspace lock.' },
    { id: 'data', label: 'Data & recovery', icon: ShieldCheck, description: 'Your saved items, sync status and recovery options.' },
  ];
function currentSettingsSection() {
  const id = location.hash.split('/')[2];
  return settingsSections.some(section => section.id === id) ? id : 'connections';
}

function Settings({ state, connection, connectionMessage, offlineReady, busy, onRefresh, onError, onToast, onOpen, onSave, canInstall, onInstall }: {
  state: LocalState; connection: Connection; connectionMessage: string; offlineReady: boolean; busy: boolean;
  onRefresh: () => Promise<void>; onError: (s: string) => void; onToast: (s: string) => void; onOpen: (r: Entry) => void;
  onSave: (r: Entry, rev?: number) => Promise<void>; canInstall: any; onInstall: () => void;
}) {
  const input = useRef<HTMLInputElement>(null); const [importing, setImporting] = useState(false);
  const [section, setSection] = useState(currentSettingsSection);
  useEffect(() => { const update = () => setSection(currentSettingsSection()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  async function importFile(file?: File) {
    if (!file) return; setImporting(true);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Choose a backup smaller than 10 MB.');
      const value = JSON.parse(await file.text()); const records = parseBackup(value);
      if (!window.confirm(`Import ${records.length} items as new copies? Existing items will stay unchanged. Importing the same backup again creates additional copies.`)) return;
      const count = await importCopies(value); onToast(`Imported ${count} items on this device.`); void onRefresh();
    } catch (e) { onError((e as Error).message); } finally { setImporting(false); if (input.current) input.current.value = ''; }
  }
  const trash = state.records.filter(r => r.deleted);
  return <div className="settings-page"><div className="page-heading"><div><p className="overline">Make it yours</p><h1>Settings</h1><p>{descriptions.settings}</p></div><span className="settings-private"><ShieldCheck size={16} /> Your personal workspace</span></div>
    <nav className="settings-navigation" aria-label="Settings sections">{settingsSections.map(({ id, label, icon: Icon }) => <button key={id} aria-pressed={section === id} aria-controls={`settings-${id}`} onClick={() => { setSection(id); location.hash = `/settings/${id}`; }}><Icon size={17} /><span>{label}</span></button>)}</nav>
    <div className="settings-section-heading"><h2>{settingsSections.find(item => item.id === section)?.label}</h2><p>{settingsSections.find(item => item.id === section)?.description}</p></div>
    <div id="settings-data" className="settings-category" hidden={section !== 'data'}>
    <div className="settings-grid"><section className="settings-panel"><div className="settings-title"><Cloud size={21} /><h2>Storage & continuity</h2></div><dl className="status-list"><div><dt>This device</dt><dd><span className="status-dot online" />{state.records.filter(r => !r.deleted).length} saved items</dd></div><div><dt>Your computer</dt><dd>{connection === 'online' ? 'Connected' : connection === 'connecting' ? 'Connecting…' : connection === 'changed' ? 'Different memory store' : 'Unavailable'}</dd></div><div><dt>Waiting to sync</dt><dd>{state.outbox.length} changes</dd></div><div><dt>Last full sync</dt><dd>{relative(state.lastSynced)}</dd></div><div><dt>Offline app</dt><dd>{offlineReady ? 'Ready on this browser' : import.meta.env.DEV ? 'Available after production build' : 'Preparing / unavailable'}</dd></div><div><dt>Local recovery copy</dt><dd>{state.backupAt ? relative(state.backupAt) : 'Created after your first synced save'}</dd></div></dl>
      <p className="settings-copy">Captures are saved on this device first. If your computer is off, changes wait here and retry when it returns. Keep this browser’s site data to preserve unsynced items.</p>{(state.backupError || connection === 'changed' || connection === 'error') && <p className="form-error">{state.backupError || connectionMessage}</p>}<button className="secondary-button" disabled={busy} onClick={() => void onRefresh()}><RefreshCw size={15} className={busy ? 'spin' : ''} />{busy ? 'Syncing…' : 'Sync now'}</button>
    </section><section className="settings-panel"><div className="settings-title"><ArrowDownToLine size={21} /><h2>Keep a copy</h2></div><p className="settings-copy">Export your current items, including changes waiting to sync. Store the file on another device or drive to protect against computer failure.</p><div className="backup-illustration" aria-hidden="true"><FileText size={37} strokeWidth={1.2} /><Check size={17} /></div><div className="button-row"><button className="primary-button" onClick={() => { download(state); onToast('Backup download started. Keep the file somewhere safe.'); }}><ArrowDownToLine size={16} />Export backup</button><button className="secondary-button" disabled={importing} onClick={() => input.current?.click()}><Copy size={15} />Import copies</button><input type="file" accept=".json,application/json" hidden ref={input} onChange={e => void importFile(e.target.files?.[0])} /></div><p className="form-hint">Exports contain your personal information in readable JSON. Local database and recovery files are not encrypted by this app yet.</p></section></div>
    <section className="settings-panel"><div className="settings-title"><Trash2 size={21} /><h2>Trash</h2></div>{trash.length ? <div className="trash-list">{trash.map(r => <div key={r.id}><span>{r.title}</span><button className="text-button" onClick={async () => { try { await onSave({ ...r, deleted: false }, r.rev); } catch (e) { onError((e as Error).message); } }}>Restore</button></div>)}</div> : <p className="settings-copy">Nothing in Trash. Removed items stay recoverable here.</p>}</section>
    </div>
    {!!state.conflicts.length && <section className="settings-panel conflicts-panel"><div className="settings-title"><Copy size={21} /><h2>Two versions to review</h2></div><p className="settings-copy">No edits were silently overwritten. Choose which complete version to keep. Export a backup first if you want to preserve your local version separately.</p>{state.conflicts.map(c => <div className="conflict-item" key={c.id}><h3>{c.local.title}</h3><div className="conflict-versions">{[{ label: 'This device', entry: c.local, local: true }, { label: 'Your computer', entry: c.remote, local: false }].map(v => <div key={v.label}><strong>{v.label}</strong><pre>{v.entry ? JSON.stringify({ title: v.entry.title, notes: v.entry.body, type: v.entry.kind, status: v.entry.status, priority: v.entry.priority, dueDate: v.entry.dueDate, birthday: v.entry.birthday, tags: v.entry.tags, source: v.entry.sourceUrl, project: v.entry.projectId, person: v.entry.personId, inTrash: v.entry.deleted }, null, 2) : 'Item no longer exists.'}</pre><button className="secondary-button" onClick={async () => { try { await resolveConflict(c.id, v.local); void onRefresh(); } catch (e) { onError((e as Error).message); } }}>Keep {v.local ? 'this device’s' : 'computer’s'} version</button></div>)}</div></div>)}</section>}
    <div id="settings-connections" className="settings-category" hidden={section !== 'connections'}>
      <ConnectionCenter />
      <EvergreenConnection />
    </div>
    <div id="settings-assistant" className="settings-category" hidden={section !== 'assistant'}>
      <div className="connection-grid assistant-connections"><ChatGPTConnection /><VoiceConnection /></div>
      <aside className="settings-guidance"><Mic size={20} /><div><h3>Speak in your own words</h3><p>Start Talk in Command for a conversation, or tap the orb to dictate a draft. OpenWhispr’s dictation hotkey also works in text fields.</p></div></aside>
    </div>
    <div id="settings-devices" className="settings-category" hidden={section !== 'devices'}>
      <ComputerControl />
      <PhoneAccess canInstall={!!canInstall} onInstall={onInstall} />
    </div>
    <div id="settings-personal" className="settings-category" hidden={section !== 'personal'}>
      <div className="settings-grid"><ProfileSettings /><PinSettings /><section className="settings-panel"><h2>Workspaces</h2><p>Switch to your other personal workspace. Each workspace keeps its own records and PIN.</p><WorkspaceSwitcher /></section></div>
    </div>
  </div>;
}
