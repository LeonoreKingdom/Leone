import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Background, Controls, MiniMap, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { api } from './api';
import leoneLogo from '../../leone.png';

const nav = [
  ['overview', 'Overview', 'admin.read'],
  ['family', 'Family Tree', null],
  ['config', 'Configuration', 'admin.read'],
  ['greetings', 'Greetings', 'greetings.manage'],
  ['audit', 'Audit Log', 'audit.read'],
  ['operations', 'Operations', 'config.write'],
];

function useLoad(loader, dependencies = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    loader().then((data) => active && setState({ loading: false, data, error: null }))
      .catch((error) => active && setState({ loading: false, data: null, error }));
    return () => { active = false; };
  }, dependencies);
  return state;
}

function Status({ state }) {
  if (state.loading) return <div className="empty">Leone is gathering the latest information…</div>;
  if (state.error) return <div className="error">{state.error.message}</div>;
  return null;
}

function Overview() {
  const state = useLoad(() => api('/admin/overview'), []);
  if (state.loading || state.error) return <Status state={state} />;
  const data = state.data;
  return <section>
    <header><p className="eyebrow">Live platform state</p><h1>Kingdom overview</h1></header>
    <div className="cards">
      <article className="card"><span>Service</span><strong className="healthy">{data.status}</strong><small>{data.release.slice(0, 12)}</small></article>
      <article className="card"><span>Database</span><strong>{data.database.latencyMs} ms</strong><small>Supabase round-trip</small></article>
      <article className="card"><span>Schedules</span><strong>{data.schedules.enabled}/{data.schedules.total}</strong><small>enabled</small></article>
      <article className="card"><span>Discord</span><strong>{data.discord.name}</strong><small>{data.discord.guildId}</small></article>
    </div>
    <Panel title="Recent greeting runs"><DataTable rows={data.recentRuns} columns={['schedule_name', 'status', 'scheduled_for', 'error_code']} /></Panel>
  </section>;
}

function Family({ me }) {
  const pathId = location.pathname.match(/^\/family\/(\d+)/)?.[1];
  const [memberId, setMemberId] = useState(pathId ?? me.user.id);
  const [depth, setDepth] = useState(2);
  const [types, setTypes] = useState('');
  const [notice, setNotice] = useState('');
  const state = useLoad(() => api(`/family/${memberId}?depth=${depth}&types=${encodeURIComponent(types)}`), [memberId, depth, types]);
  const flow = useMemo(() => {
    if (!state.data) return { nodes: [], edges: [] };
    const count = state.data.nodes.length;
    return {
      nodes: state.data.nodes.map((node, index) => {
        const angle = count === 1 ? 0 : (Math.PI * 2 * index) / count;
        return { id: node.id, data: { label: node.label }, position: node.id === state.data.rootUserId ? { x: 340, y: 220 } : { x: 340 + Math.cos(angle) * 270, y: 220 + Math.sin(angle) * 190 }, className: node.id === state.data.rootUserId ? 'root-node' : '' };
      }),
      edges: state.data.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.sourceLabel, animated: edge.type === 'partner' })),
    };
  }, [state.data]);
  async function deleteMyData() {
    if (!window.confirm('Delete all of your Leone Bonds data? This cannot be undone.')) return;
    await api('/bonds/me', { method: 'DELETE' });
    setNotice('Your Leone Bonds data has been deleted.');
  }
  return <section>
    <header><p className="eyebrow">Consent and privacy aware</p><h1>Leone Bonds family tree</h1></header>
    <div className="toolbar">
      <label>Member ID<input value={memberId} onChange={(event) => setMemberId(event.target.value.replace(/\D/g, ''))} /></label>
      <label>Depth<select value={depth} onChange={(event) => setDepth(event.target.value)}>{[1, 2, 3, 4].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Types<input value={types} onChange={(event) => setTypes(event.target.value)} placeholder="parent,sibling" /></label>
      <a className="button secondary" href="/api/v1/bonds/export">Export my data</a>
      <button className="danger" onClick={deleteMyData}>Delete my Bonds data</button>
    </div>
    {notice && <div className="notice">{notice}</div>}
    <Status state={state} />
    {state.data && <>
      <div className="flow"><ReactFlow nodes={flow.nodes} edges={flow.edges} fitView nodesDraggable={false}><MiniMap /><Controls /><Background /></ReactFlow></div>
      <Panel title="Accessible text view"><ul className="relationship-list">{state.data.edges.map((edge) => <li key={edge.id}><code>{edge.source}</code> <strong>{edge.sourceLabel}</strong> <code>{edge.target}</code></li>)}</ul>{state.data.truncated && <p>Graph capped at 50 visible members.</p>}</Panel>
    </>}
  </section>;
}

function Config({ canWrite }) {
  const state = useLoad(() => api('/admin/config'), []);
  const [notice, setNotice] = useState('');
  const [mappingDraft, setMappingDraft] = useState('');
  useEffect(() => {
    if (state.data) setMappingDraft(state.data.capabilityRoles.map((item) => `${item.role_id} ${item.capability}`).join('\n'));
  }, [state.data]);
  async function toggle(name, value) {
    await api('/admin/config', { method: 'PATCH', body: JSON.stringify({ [name]: value }) });
    setNotice('Configuration updated. Refresh to confirm the live value.');
  }
  async function saveMappings() {
    const capabilityRoles = mappingDraft.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [roleId, capability] = line.split(/\s+/);
      return { roleId, capability };
    });
    await api('/admin/config', { method: 'PATCH', body: JSON.stringify({ capabilityRoles }) });
    setNotice('Capability mappings updated and audited.');
  }
  if (state.loading || state.error) return <Status state={state} />;
  return <section><header><p className="eyebrow">Live Discord IDs</p><h1>Configuration</h1></header>
    {notice && <div className="notice">{notice}</div>}
    <div className="cards">
      <article className="card"><span>Scheduler</span><strong>{String(state.data.scheduler_enabled)}</strong>{canWrite && <button onClick={() => toggle('schedulerEnabled', !state.data.scheduler_enabled)}>Toggle</button>}</article>
      <article className="card"><span>Maintenance</span><strong>{String(state.data.maintenance_mode)}</strong>{canWrite && <button onClick={() => toggle('maintenanceMode', !state.data.maintenance_mode)}>Toggle</button>}</article>
      <article className="card"><span>Capability mappings</span><strong>{state.data.capabilityRoles.length}</strong><small>role ID grants</small></article>
    </div>
    <Panel title="Role capability mappings"><DataTable rows={state.data.capabilityRoles} columns={['role_id', 'capability']} /></Panel>
    {canWrite && <Panel title="Edit capability mappings">
      <p>Use one immutable Discord role ID and capability per line. Saving replaces the complete mapping.</p>
      <textarea value={mappingDraft} onChange={(event) => setMappingDraft(event.target.value)} rows="7" placeholder="123456789012345678 greetings.manage" />
      <div className="actions"><button onClick={saveMappings}>Save complete mapping</button></div>
    </Panel>}
    <Panel title="Discord destinations"><p>{state.data.discordOptions.channels.length} text channels and {state.data.discordOptions.roles.length} roles are currently discoverable by Leone.</p></Panel>
  </section>;
}

function Greetings() {
  const [revision, setRevision] = useState(0);
  const state = useLoad(() => Promise.all([api('/admin/config'), api('/admin/greetings/schedules'), api('/admin/greetings/runs'), api('/admin/greetings/templates')]), [revision]);
  const [preview, setPreview] = useState('');
  const [previewLabel, setPreviewLabel] = useState('Preview — no role notified');
  const [editingScheduleId, setEditingScheduleId] = useState(null);
  const [form, setForm] = useState({ occasion: 'morning', roleId: '', channelId: '', name: 'Daily greeting', localTime: '07:00', timezone: 'Asia/Jakarta', daysOfWeek: [1,2,3,4,5,6,7], adm4: '', locationLabel: '', graceMinutes: 15 });
  const [notice, setNotice] = useState('');
  if (state.loading || state.error) return <Status state={state} />;
  const [config, schedules, runs, templates] = state.data;
  const update = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));
  const updateDays = (event) => setForm((current) => ({
    ...current,
    daysOfWeek: event.target.value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item >= 1 && item <= 7),
  }));
  const formPayload = {
    ...form,
    adm4: form.adm4 || null,
    locationLabel: form.locationLabel || null,
    graceMinutes: Number(form.graceMinutes),
  };
  function scheduleToForm(schedule) {
    return {
      name: schedule.name,
      occasion: schedule.occasion,
      roleId: schedule.role_id,
      channelId: schedule.channel_id,
      localTime: String(schedule.local_time).slice(0, 5),
      timezone: schedule.timezone,
      daysOfWeek: schedule.days_of_week,
      adm4: schedule.adm4 ?? '',
      locationLabel: schedule.location_label ?? '',
      graceMinutes: schedule.grace_minutes,
    };
  }
  function editSchedule(schedule) {
    setEditingScheduleId(schedule.id);
    setForm(scheduleToForm(schedule));
    setPreview('');
    setPreviewLabel(`Preview — ${schedule.name} (no role notified)`);
    setNotice(`Editing ${schedule.name}. Saving changes will preserve its current enabled state.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function cancelEdit() {
    setEditingScheduleId(null);
    setForm({ occasion: 'morning', roleId: '', channelId: '', name: 'Daily greeting', localTime: '07:00', timezone: 'Asia/Jakarta', daysOfWeek: [1,2,3,4,5,6,7], adm4: '', locationLabel: '', graceMinutes: 15 });
    setPreview('');
    setPreviewLabel('Preview — no role notified');
    setNotice('Schedule edit cancelled.');
  }
  async function previewGreeting() {
    const result = await api('/admin/greetings/preview', { method: 'POST', body: JSON.stringify(formPayload) });
    setPreview(result.content);
    setPreviewLabel(editingScheduleId ? `Preview — ${form.name} (no role notified)` : 'Preview — no role notified');
  }
  async function createSchedule() {
    if (editingScheduleId) {
      await api(`/admin/greetings/schedules/${editingScheduleId}`, { method: 'PATCH', body: JSON.stringify(formPayload) });
      setNotice(`Schedule ${form.name} updated.`);
      setEditingScheduleId(null);
    } else {
      await api('/admin/greetings/schedules', { method: 'POST', body: JSON.stringify(formPayload) });
      setNotice('Schedule created disabled. Review it before enabling.');
    }
    setRevision((value) => value + 1);
  }
  async function previewSchedule(schedule) {
    const result = await api(`/admin/greetings/schedules/${schedule.id}/preview`, { method: 'POST', body: JSON.stringify({}) });
    setPreview(result.content);
    setPreviewLabel(`Preview — ${result.schedule.name} (${result.schedule.enabled ? 'active' : 'disabled'}; no role notified)`);
  }
  async function sendGreeting() {
    if (!preview) return setNotice('Preview the exact message before sending it.');
    const channel = config.discordOptions.channels.find((item) => item.id === form.channelId);
    const role = config.discordOptions.roles.find((item) => item.id === form.roleId);
    if (!window.confirm(`Send this greeting to #${channel?.name ?? form.channelId} and notify @${role?.name ?? form.roleId}?`)) return;
    const result = await api('/admin/greetings/send', { method: 'POST', body: JSON.stringify({ ...formPayload, confirm: true }) });
    setNotice(`Greeting sent and audited${result.url ? `: ${result.url}` : '.'}`);
    setRevision((value) => value + 1);
  }
  async function setScheduleEnabled(schedule, enabled) {
    if (enabled && !window.confirm(`Enable “${schedule.name}” for ${schedule.local_time} ${schedule.timezone}?`)) return;
    await api(`/admin/greetings/schedules/${schedule.id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
    setNotice(`${schedule.name} ${enabled ? 'enabled' : 'disabled'}.`);
    setRevision((value) => value + 1);
  }
  async function deleteSchedule(schedule) {
    if (!window.confirm(`Delete greeting schedule “${schedule.name}”?`)) return;
    await api(`/admin/greetings/schedules/${schedule.id}`, { method: 'DELETE' });
    setNotice(`${schedule.name} deleted.`);
    setRevision((value) => value + 1);
  }
  return <section><header><p className="eyebrow">Manual and opt-in automation</p><h1>Greetings</h1></header>
    {notice && <div className="notice">{notice}</div>}
    <div className="form-grid">
      <label>Occasion<select value={form.occasion} onChange={update('occasion')}>{['morning','afternoon','evening','night','custom'].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Role<select value={form.roleId} onChange={update('roleId')}><option value="">Select opt-in role</option>{config.discordOptions.roles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label>
      <label>Channel<select value={form.channelId} onChange={update('channelId')}><option value="">Select channel</option>{config.discordOptions.channels.map((channel) => <option value={channel.id} key={channel.id}>#{channel.name}</option>)}</select></label>
      <label>Schedule name<input value={form.name} onChange={update('name')} /></label>
      <label>Local time<input type="time" value={form.localTime} onChange={update('localTime')} /></label>
      <label>Timezone<input value={form.timezone} onChange={update('timezone')} /></label>
      <label>Days (ISO 1=Mon ... 7=Sun)<input value={form.daysOfWeek.join(',')} onChange={updateDays} /></label>
      <label>BMKG village code<input value={form.adm4} onChange={update('adm4')} placeholder="Optional" /></label>
      <label>Location label<input value={form.locationLabel} onChange={update('locationLabel')} /></label>
      <label>Grace period (minutes)<input type="number" min="0" max="120" value={form.graceMinutes} onChange={update('graceMinutes')} /></label>
    </div>
    <div className="actions"><button onClick={previewGreeting} disabled={!form.roleId}>Private preview</button><button className="secondary" onClick={sendGreeting} disabled={!form.roleId || !form.channelId || !preview}>Send greeting now</button><button className="secondary" onClick={createSchedule} disabled={!form.roleId || !form.channelId || !form.daysOfWeek.length}>{editingScheduleId ? 'Save schedule changes' : 'Create disabled schedule'}</button>{editingScheduleId && <button className="secondary" onClick={cancelEdit}>Cancel edit</button>}</div>
    {preview && <Panel title={previewLabel}><pre className="preview">{preview}</pre></Panel>}
    <Panel title="Templates"><DataTable rows={templates} columns={['name','occasion','version','enabled']} /></Panel>
    <Panel title="Schedules">{schedules.length ? <div className="schedule-list">{schedules.map((schedule) => <article key={schedule.id} className="schedule-item"><div><strong>{schedule.name}</strong><span>{schedule.occasion} · {String(schedule.local_time).slice(0, 5)} {schedule.timezone} · days {schedule.days_of_week.join(',')} · {schedule.enabled ? 'enabled' : 'disabled'}</span></div><div className="actions"><button className="secondary" onClick={() => previewSchedule(schedule)}>Preview</button><button className="secondary" onClick={() => editSchedule(schedule)}>Edit</button><button className="secondary" onClick={() => setScheduleEnabled(schedule, !schedule.enabled)}>{schedule.enabled ? 'Disable' : 'Enable'}</button><button className="danger" onClick={() => deleteSchedule(schedule)}>Delete</button></div></article>)}</div> : <div className="empty">No schedules yet.</div>}</Panel>
    <Panel title="Run history"><DataTable rows={runs} columns={['schedule_name','status','scheduled_for','error_code']} /></Panel>
  </section>;
}

function Audit() {
  const state = useLoad(() => api('/admin/audit'), []);
  if (state.loading || state.error) return <Status state={state} />;
  return <section><header><p className="eyebrow">Append-only operational evidence</p><h1>Audit log</h1></header><Panel title="Recent events"><DataTable rows={state.data} columns={['created_at','actor_user_id','action','target_category','result']} /></Panel></section>;
}

function Operations() {
  return <section><header><p className="eyebrow">Safe recovery controls</p><h1>Operations</h1></header><div className="warning"><strong>Emergency order:</strong> disable the database scheduler first, then set <code>GREETINGS_SCHEDULER_ENABLED=false</code> in Vercel. Promote the prior verified Vercel deployment for application rollback.</div><Panel title="Runbooks"><p>Use the deployment checklist for health probes, secret rotation, backups, interaction cutover, DNS changes, and restore rehearsal. No bot or database secrets are exposed in this dashboard.</p></Panel></section>;
}

function Panel({ title, children }) { return <article className="panel"><h2>{title}</h2>{children}</article>; }
function DataTable({ rows, columns }) {
  if (!rows?.length) return <div className="empty">No records yet.</div>;
  return <div className="table-wrap"><table><thead><tr>{columns.map((key) => <th key={key}>{key.replaceAll('_',' ')}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? index}>{columns.map((key) => <td key={key}>{row[key] == null ? '—' : typeof row[key] === 'boolean' ? String(row[key]) : String(row[key]).slice(0, 120)}</td>)}</tr>)}</tbody></table></div>;
}

function App() {
  const meState = useLoad(() => api('/me'), []);
  const initial = location.pathname.startsWith('/family') ? 'family' : location.pathname.split('/')[2] || 'overview';
  const [page, setPage] = useState(initial);
  if (meState.loading) return <main className="login"><img className="crest-logo" src={leoneLogo} alt="Leone" /><h1>Leone</h1><p>Verifying your place in the Kingdom…</p></main>;
  if (meState.error?.status === 401) return <main className="login"><img className="crest-logo" src={leoneLogo} alt="Leone" /><p className="eyebrow">Leonore's Kingdom</p><h1>Welcome to Leone</h1><p>Sign in with Discord to access your permitted family tree and administration tools.</p><a className="button" href="/auth/discord">Continue with Discord</a></main>;
  if (meState.error) return <main className="login"><div className="error">{meState.error.message}</div></main>;
  const me = meState.data;
  async function logout() {
    await api('/logout', { method: 'POST' });
    location.assign('/');
  }
  const allowed = (capability) => !capability || me.capabilities.includes(capability);
  const pages = { overview: <Overview />, family: <Family me={me} />, config: <Config canWrite={allowed('config.write')} />, greetings: <Greetings />, audit: <Audit />, operations: <Operations /> };
  return <div className="shell"><aside><div className="brand"><img className="crest-logo small" src={leoneLogo} alt="Leone" /><div><strong>Leone</strong><span>Royal companion</span></div></div><nav>{nav.filter((item) => allowed(item[2])).map(([key,label]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => { setPage(key); history.replaceState(null, '', key === 'family' ? `/family/${me.user.id}` : `/admin/${key}`); }}>{label}</button>)}</nav><div className="identity"><strong>{me.user.displayName}</strong><span>{me.owner ? 'Guild owner' : 'Kingdom member'}</span><button className="secondary logout" onClick={logout}>Sign out</button></div></aside><main>{pages[page] ?? pages.overview}</main></div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
