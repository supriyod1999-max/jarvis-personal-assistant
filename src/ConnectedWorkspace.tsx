import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCheck, ChevronRight, Clock3, FileText, FolderOpen, Inbox, Link2, Plus, Search, Sparkles, Users } from 'lucide-react';
import type { Entry, Kind } from './types';
import './connected-workspace.css';

export type WorkspaceAskContext = { label: string; message: string; recordIds: string[] };
export type ConnectedWorkspaceProps = {
  records: Entry[];
  onOpen: (entry: Entry) => void;
  onCreate: (kind: Kind, projectId?: string) => void;
  onToggle: (entry: Entry) => void | Promise<void>;
  onAsk: (context: WorkspaceAskContext) => void;
};
export type ConnectedHomeProps = ConnectedWorkspaceProps & { name?: string; onSelectProject: (id: string) => void };
export type ConnectedWorkProps = ConnectedWorkspaceProps & { projectId?: string | null; onSelectProject: (id: string | null) => void };
export type ConnectedLibraryProps = ConnectedWorkspaceProps & { initialFilter?: 'all' | 'notes' | 'people' };

const active = (records: Entry[]) => records.filter(entry => !entry.deleted && entry.status !== 'archived');
const recent = (a: Entry, b: Entry) => b.updatedAt.localeCompare(a.updatedAt);
const openTask = (entry: Entry) => entry.kind === 'task' && entry.status !== 'done';
function taskOrder(a: Entry, b: Entry) {
  return Number(a.status === 'waiting') - Number(b.status === 'waiting') || Number(b.priority === 'high') - Number(a.priority === 'high') || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || recent(a, b);
}
function dateLabel(value: string, includeYear = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(includeYear ? { year: 'numeric' as const } : {}) });
}
function localToday() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}
function sourceHref(value: string) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
function SourceLink({ entry }: { entry: Entry }) {
  const href = sourceHref(entry.sourceUrl);
  if (!href) return null;
  return <a className="cw-source-link" href={href} target="_blank" rel="noopener noreferrer"><Link2 size={14} />Original source<ArrowUpRight size={13} /><span className="cw-sr-only"> for {entry.title}</span></a>;
}
function askFor(entry: Entry, related: Entry[] = []): WorkspaceAskContext {
  return { label: entry.title, message: entry.kind === 'project' ? `Help me decide the next useful step for ${entry.title}. Use the attached project context.` : `Help me think through ${entry.title}. Use the attached saved context.`, recordIds: [...new Set([entry.id, ...related.map(item => item.id)])].slice(0, 6) };
}
function EmptyState({ icon: Icon = FolderOpen, title, text, action }: { icon?: typeof FolderOpen; title: string; text: string; action?: ReactNode }) {
  return <div className="cw-empty"><Icon size={25} strokeWidth={1.5} /><h3>{title}</h3><p>{text}</p>{action}</div>;
}
function TaskRow({ entry, project, onOpen, onToggle }: Pick<ConnectedWorkspaceProps, 'onOpen' | 'onToggle'> & { entry: Entry; project?: Entry }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const completed = entry.status === 'done', date = dateLabel(entry.dueDate), overdue = !!date && entry.dueDate < localToday() && !completed;
  async function toggle() {
    if (busy) return;
    setBusy(true); setError('');
    try { await onToggle(entry); } catch (issue) { setError(issue instanceof Error ? issue.message : 'This task could not be updated. Try again.'); } finally { setBusy(false); }
  }
  return <div className={`cw-task ${completed ? 'is-complete' : ''}`} aria-busy={busy}>
    <button type="button" className="cw-task-check" disabled={busy} aria-label={completed ? `Reopen ${entry.title}` : `Complete ${entry.title}`} aria-pressed={completed} onClick={() => void toggle()}>{completed && <Check size={14} />}</button>
    <button type="button" className="cw-task-content" onClick={() => onOpen(entry)}><span className="cw-task-title">{entry.title}</span><span className="cw-task-meta">{project && <span>{project.title}</span>}{entry.status === 'waiting' && <span>Waiting</span>}{entry.priority === 'high' && <span>High priority</span>}{date && <span className={overdue ? 'cw-overdue' : ''}>{overdue ? 'Overdue · ' : ''}{date}</span>}{!project && !date && entry.status !== 'waiting' && entry.priority !== 'high' && <span>{completed ? 'Completed task' : 'Open task'}</span>}</span></button>
    <button type="button" className="cw-icon-button" aria-label={`Open ${entry.title}`} onClick={() => onOpen(entry)}><ChevronRight size={16} /></button>
    {error && <p className="cw-inline-error" role="alert">{error}</p>}
  </div>;
}


function coverTone(entry?: Entry) { return entry ? [...entry.id].reduce((value, char) => value + char.charCodeAt(0), 0) % 3 : 0; }
function Landscape({ tone = 0 }: { tone?: number }) {
  return <svg className={`cw-landscape cw-tone-${tone}`} viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <g className="cw-landscape-stars">{[[710,72],[854,40],[1083,94],[1134,191],[674,163],[929,44]].map(([cx,cy],i)=><circle key={i} cx={cx} cy={cy} r={i%2 ? 2 : 3} style={{animationDelay:`${i * -.7}s`}} />)}</g>
    <circle className="cw-landscape-sun" cx="965" cy="139" r="67" />
    <path className="cw-landscape-back" d="M250 600C420 490 520 455 617 354C720 245 745 71 827 113C909 156 870 293 990 330C1082 359 1138 248 1240 267L1300 650Z" />
    <path className="cw-landscape-mid" d="M150 620C339 397 508 531 638 394C773 254 791 235 899 376C1034 550 1148 308 1300 408L1300 650Z" />
    <path className="cw-landscape-front" d="M-100 600C117 373 273 431 380 487C525 562 622 355 783 435C939 514 996 449 1300 548L1300 650Z" />
    <g className="cw-landscape-lines">{Array.from({length: 15}, (_, index) => <path key={index} transform={`translate(0 ${index * 12})`} d="M360 550C493 508 538 481 617 408C699 332 730 193 791 183C850 174 846 326 965 381C1077 434 1139 330 1250 362" />)}</g>
    <g className="cw-landscape-fine">{Array.from({length: 9}, (_, index) => <path key={index} transform={`translate(0 ${index * 13})`} d="M-40 588C123 433 247 467 386 524C526 582 612 432 730 472C872 520 1031 492 1281 584" />)}</g>
  </svg>;
}
function ProjectCover({ entry }: { entry: Entry }) {
  return <div className={`cw-project-cover cw-tone-${coverTone(entry)}`} aria-hidden="true"><Landscape tone={coverTone(entry)} /><span>{entry.tags[0] || 'Project'}</span></div>;
}

export function ConnectedHome({ records, name, onOpen, onCreate, onToggle, onAsk, onSelectProject }: ConnectedHomeProps) {
  const [focusIndex, setFocusIndex] = useState(0);
  const [motion, setMotion] = useState(() => { try { return localStorage.getItem('jarvis-landscape-motion') !== 'off'; } catch { return true; } });
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => { const change = () => setVisible(!document.hidden); document.addEventListener('visibilitychange', change); return () => document.removeEventListener('visibilitychange', change); }, []);
  function toggleMotion() { setMotion(value => { try { localStorage.setItem('jarvis-landscape-motion', value ? 'off' : 'on'); } catch {} return !value; }); }
  const items = useMemo(() => active(records), [records]);
  const projects = items.filter(entry => entry.kind === 'project' && entry.status !== 'done').sort(recent);
  const tasks = items.filter(openTask).sort(taskOrder), captures = items.filter(entry => entry.kind === 'inbox' && entry.status !== 'done').sort(recent);
  const notes = items.filter(entry => entry.kind === 'note').sort(recent);
  const readyTasks = tasks.filter(entry => entry.status !== 'waiting');
  const todayTasks = readyTasks.filter(entry => entry.dueDate && entry.dueDate <= localToday());
  // Daily focus leads with due/overdue work; projects remain available in Work.
  const candidates = todayTasks.length ? todayTasks : readyTasks.length ? readyTasks : projects;
  const index = Math.min(focusIndex, Math.max(0, candidates.length - 1)), featured = candidates[index];
  const relatedTasks = featured?.kind === 'project' ? tasks.filter(entry => entry.projectId === featured.id) : [];
  function move(direction: number) { setFocusIndex((index + direction + candidates.length) % candidates.length); }
  return <section className={`connected-workspace cw-home${motion && visible ? ' cw-motion-live' : ''}`} aria-labelledby="connected-home-title">
    <header className="cw-page-heading"><div><p className="cw-eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · Daily focus</p><h1 id="connected-home-title">{name ? `Welcome back, ${name}.` : 'Welcome back.'}</h1></div><a className="cw-button cw-button-secondary" href="#/today"><Clock3 size={17} />Plan today</a></header>
    <div className={`cw-home-stage${candidates.length > 1 ? ' has-neighbors' : ''}`}>
      {candidates.length > 1 && <><div className="cw-stage-preview is-previous" aria-hidden="true"><Landscape tone={coverTone(candidates[(index + candidates.length - 1) % candidates.length])} /><span>{candidates[(index + candidates.length - 1) % candidates.length].title}</span></div><div className="cw-stage-preview is-next" aria-hidden="true"><Landscape tone={coverTone(candidates[(index + 1) % candidates.length])} /><span>{candidates[(index + 1) % candidates.length].title}</span></div><button type="button" className="cw-stage-arrow is-previous" aria-label="Previous project or task" onClick={() => move(-1)}><ArrowLeft size={20} /></button><button type="button" className="cw-stage-arrow is-next" aria-label="Next project or task" onClick={() => move(1)}><ArrowRight size={20} /></button></>}
      <section className="cw-feature" aria-label="Continue your work">
        <Landscape tone={coverTone(featured)} />
        <div className="cw-feature-copy" key={featured?.id || 'start'} aria-live="polite"><p className="cw-eyebrow">{featured ? featured.kind === 'project' ? 'Project · Your workspace' : 'Task · Your next step' : 'Your space to think and do'}</p><h2>{featured?.title || 'Make room for your next big idea.'}</h2><p className="cw-feature-description">{featured ? featured.body || (featured.kind === 'project' ? 'Your goal, next steps and useful context, together.' : 'A little progress starts here.') : 'Bring a thought, a question, or something you want to make happen.'}</p></div>
        <div className="cw-feature-bottom">{featured ? <button type="button" className="cw-button cw-button-quiet" onClick={() => onAsk(askFor(featured, relatedTasks))}><Sparkles size={17} />Think it through</button> : <button type="button" className="cw-button cw-button-quiet" onClick={() => onCreate('note')}><FileText size={17} />Save a note</button>}<button type="button" className="cw-button cw-button-primary" onClick={() => featured ? featured.kind === 'project' ? onSelectProject(featured.id) : onOpen(featured) : onCreate('project')}>{featured ? featured.kind === 'project' ? 'Open project' : 'Open next step' : 'Start a project'}<ArrowRight size={17} /></button></div>
        {candidates.length > 0 && <span className="cw-scene-count">{String(index + 1).padStart(2, '0')} / {String(candidates.length).padStart(2, '0')}</span>}
      </section>
    </div>
    <div className="cw-motion-control"><button type="button" onClick={toggleMotion} aria-pressed={motion}>{motion ? 'Pause background motion' : 'Play background motion'}</button></div>
    <div className="cw-home-grid">
      <section className="cw-home-tasks" aria-labelledby="home-next-title"><div className="cw-section-heading"><div><h2 id="home-next-title">Next steps</h2><p>One thing at a time.</p></div><button type="button" className="cw-text-button" onClick={() => onCreate('task')}><Plus size={15} />Add task</button></div>{tasks.length ? <div className="cw-task-ledger">{tasks.slice(0, 5).map(entry => <TaskRow key={entry.id} entry={entry} project={projects.find(item => item.id === entry.projectId)} onOpen={onOpen} onToggle={onToggle} />)}{tasks.length > 5 && <a className="cw-text-button cw-list-footer" href="#/tasks">All tasks<ArrowRight size={15} /></a>}</div> : <div className="cw-inline-empty"><CheckCheck size={22} /><div><strong>No open tasks.</strong><p>Add a next step when you are ready.</p></div></div>}</section>
      <section className="cw-attention" aria-labelledby="home-review-title"><div className="cw-section-heading"><div><h2 id="home-review-title">To sort</h2><p>{captures.length ? `${captures.length} capture${captures.length === 1 ? '' : 's'} waiting for a home.` : 'Your inbox is clear.'}</p></div><Inbox size={18} /></div>{captures.length ? <div className="cw-capture-list">{captures.slice(0, 3).map(entry => <button type="button" className="cw-capture" key={entry.id} onClick={() => onOpen(entry)}><span className="cw-capture-icon"><FileText size={17} /></span><span><strong>{entry.title}</strong><small>{entry.body || 'Review this capture'}</small></span><ChevronRight size={16} /></button>)}{captures.length > 3 && <a className="cw-text-button cw-list-footer" href="#/inbox">Review all captures<ArrowRight size={15} /></a>}</div> : <button type="button" className="cw-empty-capture" onClick={() => onCreate('inbox')}><Plus size={19} /><span>Save a thought for later</span></button>}</section>
    </div>
    {notes.length > 0 && <section className="cw-home-context" aria-labelledby="home-context-title"><div className="cw-section-heading"><div><h2 id="home-context-title">Close at hand</h2><p>A few things you recently saved.</p></div><a className="cw-text-button" href="#/library">Open library<ArrowRight size={15} /></a></div><div className="cw-recent-notes">{notes.slice(0, 3).map(entry => <article className="cw-context-row" key={entry.id}><button type="button" onClick={() => onOpen(entry)}><FileText size={19} strokeWidth={1.5} /><span><small>{items.find(item => item.id === entry.projectId)?.title || 'Saved note'}</small><strong>{entry.title}</strong><span className="cw-context-excerpt">{entry.body || 'Open this note'}</span></span><ArrowUpRight size={15} /></button><SourceLink entry={entry} /></article>)}</div></section>}
  </section>;
}

export function ConnectedWork({ records, projectId, onSelectProject, onOpen, onCreate, onToggle, onAsk }: ConnectedWorkProps) {
  const [taskFilter, setTaskFilter] = useState<'open' | 'done'>('open');
  const items = useMemo(() => active(records), [records]), projects = items.filter(entry => entry.kind === 'project').sort(recent);
  const tasks = items.filter(entry => entry.kind === 'task').sort(taskOrder), project = projects.find(entry => entry.id === projectId);
  if (projectId && !project) return <section className="connected-workspace"><button type="button" className="cw-back" onClick={() => onSelectProject(null)}><ArrowLeft size={16} />All work</button><EmptyState title="This project is no longer here." text="It may have been archived or removed. Your other work is still available." action={<button type="button" className="cw-button cw-button-secondary" onClick={() => onSelectProject(null)}>Back to your work</button>} /></section>;
  if (!project) {
    const unassigned = tasks.filter(entry => !entry.projectId && entry.status !== 'done');
    return <section className="connected-workspace cw-work" aria-labelledby="connected-work-title"><header className="cw-page-heading"><div><p className="cw-eyebrow">Your work</p><h1 id="connected-work-title">Your workspace.</h1><p>Projects keep your tasks and their context together.</p></div><button type="button" className="cw-button cw-button-primary" onClick={() => onCreate('project')}><Plus size={16} />New project</button></header>
      {projects.length ? <div className="cw-project-grid">{projects.map(entry => { const relatedTasks = tasks.filter(task => task.projectId === entry.id), open = relatedTasks.filter(openTask); return <button type="button" className="cw-project" key={entry.id} onClick={() => onSelectProject(entry.id)}><ProjectCover entry={entry} /><span className="cw-project-heading"><FolderOpen size={17} /><ArrowUpRight size={17} /></span><h2>{entry.title}</h2><p>{entry.body || 'A goal, its next steps, and the things worth keeping close.'}</p><span className="cw-project-foot">{entry.status === 'done' ? <><CheckCheck size={14} />Completed project</> : <>{open.length} open task{open.length === 1 ? '' : 's'}{relatedTasks.length > open.length && <span>· {relatedTasks.length - open.length} completed</span>}</>}</span></button>; })}</div> : <EmptyState title="Start with one project." text="A project can be an app, a personal plan, or something you want to learn." action={<button type="button" className="cw-button cw-button-secondary" onClick={() => onCreate('project')}><Plus size={16} />Create a project</button>} />}
      <section className="cw-standalone-tasks"><div className="cw-section-heading"><h2>Individual next steps</h2><button type="button" className="cw-text-button" onClick={() => onCreate('task')}><Plus size={15} />Add task</button></div>{unassigned.length ? unassigned.map(entry => <TaskRow key={entry.id} entry={entry} onOpen={onOpen} onToggle={onToggle} />) : <p className="cw-section-copy">Tasks without a project will appear here.</p>}</section>
    </section>;
  }
  const related = items.filter(entry => entry.projectId === project.id), projectTasks = tasks.filter(entry => entry.projectId === project.id), notes = related.filter(entry => entry.kind === 'note').sort(recent);
  const peopleIds = new Set([project.personId, ...related.map(entry => entry.personId)]), people = items.filter(entry => entry.kind === 'person' && (entry.projectId === project.id || peopleIds.has(entry.id)));
  const filteredTasks = projectTasks.filter(entry => taskFilter === 'done' ? entry.status === 'done' : entry.status !== 'done');
  const sources = [project, ...related].filter(entry => !!sourceHref(entry.sourceUrl));
  return <section className="connected-workspace cw-project-desk" aria-labelledby="project-desk-title"><button type="button" className="cw-back" onClick={() => onSelectProject(null)}><ArrowLeft size={16} />All work</button><header className="cw-page-heading cw-desk-heading"><Landscape tone={coverTone(project)} /><div><p className="cw-eyebrow">Project desk{project.status === 'done' ? ' · Completed' : ''}</p><h1 id="project-desk-title">{project.title}</h1></div><button type="button" className="cw-button cw-button-secondary" onClick={() => onOpen(project)}>Edit project</button></header>
    <div className="cw-desk-grid"><div className="cw-desk-main"><section className="cw-goal"><h2>The goal</h2><p>{project.body || 'Describe what you want to achieve, so the next steps have a clear direction.'}</p>{!project.body && <button type="button" className="cw-text-button" onClick={() => onOpen(project)}>Add a goal<ArrowRight size={15} /></button>}</section>
      <section className="cw-desk-tasks"><div className="cw-section-heading"><h2>Next steps</h2><button type="button" className="cw-text-button" onClick={() => onCreate('task', project.id)}><Plus size={15} />Add task</button></div><div className="cw-filter" role="group" aria-label="Project task filter"><button type="button" aria-pressed={taskFilter === 'open'} onClick={() => setTaskFilter('open')}>To do<span>{projectTasks.filter(openTask).length}</span></button><button type="button" aria-pressed={taskFilter === 'done'} onClick={() => setTaskFilter('done')}>Completed<span>{projectTasks.filter(entry => entry.status === 'done').length}</span></button></div>{filteredTasks.length ? filteredTasks.map(entry => <TaskRow key={entry.id} entry={entry} onOpen={onOpen} onToggle={onToggle} />) : <p className="cw-section-copy">{taskFilter === 'done' ? 'Completed steps will stay here for reference.' : 'Choose one next step to move this project forward.'}</p>}</section>
      <section className="cw-desk-notes"><div className="cw-section-heading"><h2>Notes & decisions</h2><button type="button" className="cw-text-button" onClick={() => onCreate('note', project.id)}><Plus size={15} />Add note</button></div>{notes.length ? notes.map(entry => <article className="cw-project-note" key={entry.id}><button type="button" onClick={() => onOpen(entry)}><h3>{entry.title}</h3><p>{entry.body || 'Open this note to add the details.'}</p></button><SourceLink entry={entry} /></article>) : <p className="cw-section-copy">Keep useful ideas and the reasons behind your decisions with this project.</p>}</section>
    </div><aside className="cw-desk-context" aria-label="Project context"><section><h2>Context, close by</h2><button type="button" className="cw-button cw-button-primary cw-ask-project" onClick={() => onAsk(askFor(project, [...projectTasks.filter(openTask), ...notes]))}><Sparkles size={16} />Think with JARVIS</button><p className="cw-context-hint">Opens a draft with selected project context for your review.</p></section><section><h3>Original sources</h3>{sources.length ? sources.map(entry => <div className="cw-desk-source" key={entry.id}><span>{entry.title}</span><SourceLink entry={entry} /></div>) : <p className="cw-section-copy">Add a source link to a note to keep the original within reach.</p>}</section><section><h3>People</h3>{people.length ? people.map(entry => <button type="button" className="cw-person-mini" key={entry.id} onClick={() => onOpen(entry)}><span className="cw-person-avatar">{entry.title.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase()}</span><span><strong>{entry.title}</strong><small>{entry.relationship || 'Linked to this project'}</small></span></button>) : <p className="cw-section-copy">People linked to this project or its tasks will appear here.</p>}</section>{project.dueDate && <div className="cw-project-due"><Clock3 size={15} /><span>Project date · {dateLabel(project.dueDate, true)}</span></div>}</aside></div>
  </section>;
}

export function ConnectedLibrary({ records, initialFilter = 'all', onOpen, onCreate, onAsk }: ConnectedLibraryProps) {
  const [filter, setFilter] = useState<'all' | 'notes' | 'people'>(initialFilter), [query, setQuery] = useState('');
  const items = useMemo(() => active(records), [records]), library = items.filter(entry => ['note', 'person'].includes(entry.kind)).sort(recent);
  const visible = library.filter(entry => (filter === 'all' || (filter === 'notes' ? entry.kind === 'note' : entry.kind === 'person')) && (!query.trim() || [entry.title, entry.body, entry.relationship || '', ...entry.tags, ...(entry.aliases || [])].join(' ').toLowerCase().includes(query.trim().toLowerCase())));
  return <section className="connected-workspace cw-library" aria-labelledby="connected-library-title"><header className="cw-page-heading"><div><p className="cw-eyebrow">Your library</p><h1 id="connected-library-title">Your library.</h1><p>Keep your notes, sources and people close to your work.</p></div><button type="button" className="cw-button cw-button-primary" onClick={() => onCreate(filter === 'people' ? 'person' : 'note')}><Plus size={16} />{filter === 'people' ? 'Add person' : 'Add note'}</button></header>
    <div className="cw-library-toolbar"><div className="cw-filter" role="group" aria-label="Library filter">{([['all', 'Everything'], ['notes', 'Notes'], ['people', 'People']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div><label className="cw-library-search"><Search size={16} /><span className="cw-sr-only">Search notes and people</span><input type="search" placeholder="Find in your library…" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
    <p className="cw-result-count" aria-live="polite">{visible.length} {visible.length === 1 ? 'item' : 'items'}{query.trim() ? ` matching “${query.trim()}”` : ''}</p>
    {visible.length ? <div className="cw-library-grid">{visible.map(entry => { const project = items.find(item => item.kind === 'project' && item.id === entry.projectId); return <article className={`cw-library-entry ${entry.kind === 'person' ? 'cw-library-person' : ''}`} key={entry.id}><div className="cw-library-entry-top"><span>{entry.kind === 'person' ? <span className="cw-person-avatar">{entry.title.split(/\s+/).filter(Boolean).map(word => [...word][0]).slice(0, 2).join('').toUpperCase()}</span> : <FileText size={20} strokeWidth={1.5} />}{entry.kind === 'person' ? 'Person' : sourceHref(entry.sourceUrl) ? 'Note with a source' : 'Note'}</span>{entry.recall === true && <span className="cw-recall-label">Recall enabled</span>}</div><button type="button" className="cw-library-open" onClick={() => onOpen(entry)}><h2>{entry.title}</h2><p>{entry.body || (entry.kind === 'person' ? entry.relationship || 'Open to add things worth remembering.' : 'Open to add your own notes.')}</p></button>{project && <span className="cw-linked-project"><FolderOpen size={13} />{project.title}</span>}{entry.kind === 'person' && entry.birthday && <span className="cw-person-date">Birthday · {dateLabel(entry.birthday)}</span>}<div className="cw-library-footer"><SourceLink entry={entry} /><button type="button" className="cw-text-button" onClick={() => onAsk(askFor(entry))}><Sparkles size={14} />Ask JARVIS<span className="cw-sr-only"> about {entry.title}</span></button></div></article>; })}</div> : <EmptyState icon={filter === 'people' ? Users : BookOpen} title={query.trim() ? 'No matching items.' : filter === 'people' ? 'Remember your people.' : 'Keep something worth returning to.'} text={query.trim() ? 'Try a name, phrase, relationship or tag.' : filter === 'people' ? 'Save names, relationships and the details you choose to remember.' : 'A useful link, an idea, or a decision can start a note.'} action={query.trim() ? <button type="button" className="cw-button cw-button-secondary" onClick={() => setQuery('')}>Clear search</button> : <button type="button" className="cw-button cw-button-secondary" onClick={() => onCreate(filter === 'people' ? 'person' : 'note')}><Plus size={16} />{filter === 'people' ? 'Add a person' : 'Create a note'}</button>} />}
  </section>;
}
