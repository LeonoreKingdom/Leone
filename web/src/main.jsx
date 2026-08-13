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
  ['moderation', 'Moderation', 'moderation.read'],
  ['server-admin', 'Server Administration', 'server.roles.read'],
  ['chatbot', 'Chatbot', 'chatbot.manage'],
  ['audit', 'Audit Log', 'audit.read'],
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

const capabilityOptions = [
  { value: 'chatbot.manage', label: 'Chatbot manage — configure AI and knowledge' },
  { value: 'moderation.read', label: 'Moderation read' },
  { value: 'moderation.warn', label: 'Moderation warn' },
  { value: 'moderation.timeout', label: 'Moderation timeout' },
  { value: 'moderation.kick', label: 'Moderation kick' },
  { value: 'moderation.ban', label: 'Moderation ban' },
  { value: 'moderation.messages', label: 'Moderation messages' },
  { value: 'server.roles.read', label: 'Server roles read' },
  { value: 'server.roles.assign', label: 'Server roles assign' },
  { value: 'server.roles.manage', label: 'Server roles manage' },
  { value: 'server.channels.read', label: 'Server channels read' },
  { value: 'server.channels.manage', label: 'Server channels manage' },
  { value: 'admin.read', label: 'Admin read — view dashboard' },
  { value: 'config.write', label: 'Configuration write — edit settings' },
  { value: 'greetings.manage', label: 'Greetings manage — send and schedule' },
  { value: 'audit.read', label: 'Audit read — view audit log' },
  { value: 'relationships.abuse', label: 'Relationships abuse — review reports' },
];

function capabilityLabel(value) {
  return capabilityOptions.find((option) => option.value === value)?.label ?? value;
}

function groupCapabilityMappings(mappings, roles) {
  const roleNames = new Map(roles.map((role) => [role.id, role.name]));
  const grouped = new Map();
  for (const mapping of mappings) {
    const current = grouped.get(mapping.role_id) ?? {
      roleId: mapping.role_id,
      roleName: roleNames.get(mapping.role_id) ?? mapping.role_id,
      capabilities: [],
    };
    if (!current.capabilities.includes(mapping.capability)) current.capabilities.push(mapping.capability);
    grouped.set(mapping.role_id, current);
  }
  return [...grouped.values()].sort((left, right) => left.roleName.localeCompare(right.roleName));
}

function CapabilityTags({ capabilities }) {
  if (!capabilities.length) return <span className="muted">No permissions selected</span>;
  return <div className="tags">{capabilities.map((capability) => <span className="tag" key={capability}>{capabilityLabel(capability)}</span>)}</div>;
}

function CapabilityMappingTable({ mappings, roles }) {
  const grouped = groupCapabilityMappings(mappings, roles);
  if (!grouped.length) return <div className="empty">No role mappings configured.</div>;
  return <div className="table-wrap"><table><thead><tr><th>Role</th><th>Capabilities</th><th>Permission count</th></tr></thead><tbody>{grouped.map((mapping) => <tr key={mapping.roleId}><td><code>@{mapping.roleName}</code></td><td><CapabilityTags capabilities={mapping.capabilities} /></td><td>{mapping.capabilities.length}</td></tr>)}</tbody></table></div>;
}

function Config({ canWrite }) {
  const state = useLoad(() => api('/admin/config'), []);
  const [notice, setNotice] = useState('');
  const [mappingDraft, setMappingDraft] = useState([]);
  useEffect(() => {
    if (!state.data) return;
    const roles = state.data.discordOptions.roles;
    setMappingDraft(groupCapabilityMappings(state.data.capabilityRoles, roles).map((item) => ({
      roleId: item.roleId,
      roleQuery: item.roleName,
      capabilities: item.capabilities,
    })));
  }, [state.data]);
  function updateMapping(index, changes) {
    setMappingDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item));
  }
  function addMapping() {
    setMappingDraft((current) => [...current, { roleId: '', roleQuery: '', capabilities: [] }]);
  }
  function removeMapping(index) {
    setMappingDraft((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }
  async function toggleScheduler(value) {
    await api('/admin/config', { method: 'PATCH', body: JSON.stringify({ schedulerEnabled: value }) });
    setNotice('Scheduler configuration updated.');
  }
  async function saveMappings() {
    if (mappingDraft.some((item) => !item.roleId || !item.capabilities.length)) {
      setNotice('Select a valid Discord role and at least one permission for every mapping.');
      return;
    }
    const capabilityRoles = mappingDraft.flatMap(({ roleId, capabilities }) => capabilities.map((capability) => ({ roleId, capability })));
    await api('/admin/config', { method: 'PATCH', body: JSON.stringify({ capabilityRoles }) });
    setNotice('Capability mappings updated and audited.');
  }
  if (state.loading || state.error) return <Status state={state} />;
  const roles = state.data.discordOptions.roles;
  const groupedMappings = groupCapabilityMappings(state.data.capabilityRoles, roles);
  return <section><header><p className="eyebrow">Live Discord IDs</p><h1>Configuration</h1></header>
    {notice && <div className="notice">{notice}</div>}
    <div className="cards">
      <article className="card"><span>Scheduler</span><strong>{String(state.data.scheduler_enabled)}</strong>{canWrite && <button onClick={() => toggleScheduler(!state.data.scheduler_enabled)}>Toggle</button>}</article>
      <article className="card"><span>Capability mappings</span><strong>{groupedMappings.length}</strong><small>roles with grants</small></article>
    </div>
    <Panel title="Role capability mappings"><CapabilityMappingTable mappings={state.data.capabilityRoles} roles={roles} /></Panel>
    {canWrite && <Panel title="Edit capability mappings">
      <p>Group permissions under one Discord role. Saving replaces the complete mapping.</p>
      {mappingDraft.length === 0 && <div className="empty">No role mappings configured.</div>}
      {mappingDraft.map((mapping, index) => <div className="mapping-row" key={`${mapping.roleId || 'new'}-${index}`}>
        <div className="form-grid">
        <label>Discord role<input list="config-role-options" value={mapping.roleQuery} onChange={(event) => {
          const roleQuery = event.target.value;
          const selectedRole = roles.find((role) => role.id === roleQuery || role.name.toLowerCase() === roleQuery.toLowerCase());
          updateMapping(index, { roleQuery, roleId: selectedRole?.id ?? '' });
        }} placeholder="Search Supreme Royalty, Admin, Mod…" /></label>
        <div><span className="field-label">Permissions</span><details className="permission-picker"><summary>{mapping.capabilities.length ? `${mapping.capabilities.length} selected` : 'Select permissions'}</summary><div className="permission-menu">{capabilityOptions.map((option) => <label key={option.value}><input type="checkbox" checked={mapping.capabilities.includes(option.value)} onChange={() => updateMapping(index, { capabilities: mapping.capabilities.includes(option.value) ? mapping.capabilities.filter((value) => value !== option.value) : [...mapping.capabilities, option.value] })} />{option.label}</label>)}</div></details><CapabilityTags capabilities={mapping.capabilities} /></div>
        <button className="danger" onClick={() => removeMapping(index)}>Remove</button>
        </div>
      </div>)}
      <datalist id="config-role-options">{roles.map((role) => <option value={role.name} key={role.id}>{role.name}</option>)}</datalist>
      <div className="actions"><button className="secondary" onClick={addMapping}>Add role mapping</button><button onClick={saveMappings}>Save complete mapping</button></div>
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

function Moderation() {
  const [revision, setRevision] = useState(0);
  const state = useLoad(() => Promise.all([api('/admin/moderation/summary'), api('/admin/moderation/cases')]), [revision]);
  const [form, setForm] = useState({ action: 'warn', targetUserId: '', reason: '', durationSeconds: 3600, deleteMessageSeconds: 0, channelId: '', messageCount: 10, sendDm: false });
  const [memberQuery, setMemberQuery] = useState('');
  const [members, setMembers] = useState([]);
  const [notice, setNotice] = useState('');
  if (state.loading || state.error) return <Status state={state} />;
  const [summary, cases] = state.data;
  const update = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  async function searchMembers() {
    const result = await api(`/admin/moderation/members?query=${encodeURIComponent(memberQuery)}`);
    setMembers(result);
  }
  async function execute() {
    if (!form.targetUserId && form.action !== 'purge') return setNotice('Select a target member first.');
    if (!form.reason.trim()) return setNotice('A reason is required.');
    if (!window.confirm(`Confirm ${form.action} for ${form.targetUserId || 'the selected channel'}?`)) return;
    await api('/admin/moderation/actions', { method: 'POST', body: JSON.stringify({ ...form, targetUserId: form.targetUserId || undefined, durationSeconds: Number(form.durationSeconds), deleteMessageSeconds: Number(form.deleteMessageSeconds), messageCount: Number(form.messageCount), channelId: form.channelId || undefined, confirm: true, clientRequestId: crypto.randomUUID() }) });
    setNotice('Moderation action completed and audited.');
    setRevision((value) => value + 1);
  }
  return <section><header><p className="eyebrow">Controlled, case-based administration</p><h1>Moderation</h1></header>
    {notice && <div className="notice">{notice}</div>}
    <div className="cards"><article className="card"><span>Leone role</span><strong>{summary.readiness.bot.roleName ?? 'Not found'}</strong><small>position {summary.readiness.bot.rolePosition ?? '—'}</small></article>{Object.entries(summary.readiness.permissions).map(([name, enabled]) => <article className="card" key={name}><span>{name}</span><strong className={enabled ? 'healthy' : 'danger'}>{enabled ? 'Ready' : 'Missing'}</strong></article>)}</div>
    <Panel title="New moderation action"><div className="form-grid">
      <label>Action<select value={form.action} onChange={update('action')}>{['warn','timeout','untimeout','kick','ban','unban','purge'].map((action) => <option key={action}>{action}</option>)}</select></label>
      {form.action !== 'purge' && <label>Target user ID<input value={form.targetUserId} onChange={update('targetUserId')} placeholder="Discord user ID" /></label>}
      <label>Reason<textarea rows="2" value={form.reason} onChange={update('reason')} maxLength="512" /></label>
      {(form.action === 'timeout') && <label>Duration seconds<input type="number" min="1" max="2419200" value={form.durationSeconds} onChange={update('durationSeconds')} /></label>}
      {(form.action === 'ban') && <label>Delete messages seconds<input type="number" min="0" max="604800" value={form.deleteMessageSeconds} onChange={update('deleteMessageSeconds')} /></label>}
      {(form.action === 'purge') && <><label>Channel ID<input value={form.channelId} onChange={update('channelId')} /></label><label>Message count<input type="number" min="1" max="100" value={form.messageCount} onChange={update('messageCount')} /></label></>}
      {form.action !== 'purge' && <label className="checkbox"><input type="checkbox" checked={form.sendDm} onChange={update('sendDm')} /> Send member DM</label>}
    </div><div className="actions"><button onClick={execute}>Confirm and execute</button><input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Search member" /><button className="secondary" onClick={searchMembers}>Search</button></div>{members.length > 0 && <div className="tags">{members.map((member) => <button className="tag" key={member.id} onClick={() => setForm((current) => ({ ...current, targetUserId: member.id }))}>{member.displayName} ({member.id})</button>)}</div>}</Panel>
    <Panel title="Recent moderation cases"><DataTable rows={cases} columns={['case_number','created_at','action','target','actor','result','reason']} /></Panel>
  </section>;
}

function Chatbot() {
  const [revision, setRevision] = useState(0);
  const state = useLoad(() => Promise.all([api('/admin/chatbot/settings'), api('/admin/chatbot/knowledge/status')]), [revision]);
  const [form, setForm] = useState({ enabled: false, channelIds: [], triggerMode: 'mention_dm', retentionDays: 30, perUserCooldownSeconds: 15, dailyRequestLimit: 500, model: '' });
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!state.data) return;
    const settings = state.data[0].settings;
    setForm({ enabled: Boolean(settings.enabled), channelIds: settings.channelIds ?? [], triggerMode: settings.triggerMode ?? 'mention_dm', retentionDays: settings.retentionDays ?? 30, perUserCooldownSeconds: settings.perUserCooldownSeconds ?? 15, dailyRequestLimit: settings.dailyRequestLimit ?? 500, model: settings.model ?? '' });
  }, [state.data]);
  if (state.loading || state.error) return <Status state={state} />;
  const [info, status] = state.data;
  const update = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  function toggleChannel(channelId) { setForm((current) => ({ ...current, channelIds: current.channelIds.includes(channelId) ? current.channelIds.filter((id) => id !== channelId) : [...current.channelIds, channelId] })); }
  async function save() { await api('/admin/chatbot/settings', { method: 'PATCH', body: JSON.stringify({ ...form, retentionDays: Number(form.retentionDays), perUserCooldownSeconds: Number(form.perUserCooldownSeconds), dailyRequestLimit: Number(form.dailyRequestLimit) }) }); setNotice('Chatbot settings saved and audited.'); setRevision((value) => value + 1); }
  async function reindex() { await api('/admin/chatbot/knowledge/reindex', { method: 'POST', body: '{}' }); setNotice('Canonical server knowledge reindexed.'); setRevision((value) => value + 1); }
  async function purge() { if (!window.confirm('Purge all message-derived chatbot knowledge? Canonical documents are kept.')) return; const result = await api('/admin/chatbot/knowledge/purge', { method: 'POST', body: '{}' }); setNotice(`Purged ${result.deleted} message-derived chunks.`); setRevision((value) => value + 1); }
  return <section><header><p className="eyebrow">Mention and DM companion</p><h1>Chatbot</h1></header>{notice && <div className="notice">{notice}</div>}
    <div className="cards"><article className="card"><span>Groq</span><strong className={info.readiness.groq ? 'healthy' : 'danger'}>{info.readiness.groq ? 'Ready' : 'Missing key'}</strong><small>server-side only</small></article><article className="card"><span>Gateway worker</span><strong className={info.readiness.gateway ? 'healthy' : 'danger'}>{info.readiness.gateway ? 'Configured' : 'Missing token'}</strong><small>{status.worker_last_seen ? `last seen ${new Date(status.worker_last_seen).toLocaleString()}` : 'not seen yet'}</small></article><article className="card"><span>Canonical chunks</span><strong>{status.canonical_chunks ?? 0}</strong><small>{status.documents ?? 0} documents</small></article><article className="card"><span>Message chunks</span><strong>{status.message_chunks ?? 0}</strong><small>retention governed</small></article></div>
    <Panel title="Chatbot configuration"><div className="form-grid"><label className="checkbox"><input type="checkbox" checked={form.enabled} onChange={update('enabled')} /> Enable chatbot</label><label>Trigger mode<select value={form.triggerMode} onChange={update('triggerMode')}><option value="mention_dm">Mention and DM (recommended)</option><option value="auto_response">Auto-response (use strict limits)</option></select></label><label>Retention<select value={form.retentionDays} onChange={update('retentionDays')}><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label><label>Per-user cooldown (seconds)<input type="number" min="0" max="3600" value={form.perUserCooldownSeconds} onChange={update('perUserCooldownSeconds')} /></label><label>Daily request limit<input type="number" min="0" max="100000" value={form.dailyRequestLimit} onChange={update('dailyRequestLimit')} /></label><label>Groq model<input value={form.model} onChange={update('model')} placeholder="Account-available model" /></label></div><p className="muted">Only approved public channels are ingested. DMs are answered but never added to shared server knowledge.</p><div className="channel-picker"><span className="field-label">Approved public channels</span>{info.channels.map((channel) => <label className="checkbox" key={channel.id}><input type="checkbox" checked={form.channelIds.includes(channel.id)} onChange={() => toggleChannel(channel.id)} /> #{channel.name}</label>)}</div><div className="actions"><button onClick={save}>Save settings</button><button className="secondary" onClick={reindex}>Reindex canonical knowledge</button><button className="danger" onClick={purge}>Purge message knowledge</button></div></Panel>
    <Panel title="Readiness and data policy"><ul className="relationship-list"><li>Trigger default: mention/DM only.</li><li>No historical backfill; ingestion starts after enablement.</li><li>AI replies are generated by Groq and may be incorrect.</li><li>No raw prompts or responses are stored; only usage metadata is retained.</li><li>Administrative and moderation actions remain deterministic slash/API flows.</li></ul></Panel>
  </section>;
}

function ServerAdmin({ canConfig }) {
  const [revision, setRevision] = useState(0);
  const state = useLoad(() => Promise.all([api('/admin/server/roles'), api('/admin/server/channels')]), [revision]);
  const [roleForm, setRoleForm] = useState({ action: 'assign', roleId: '', memberIds: '', reason: 'Server administration' });
  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState([]);
  const [roleEdit, setRoleEdit] = useState({ roleId: '', name: '', color: 0, hoist: false, mentionable: false });
  const [channelForm, setChannelForm] = useState({ type: 0, name: '', parentId: '', topic: '', reason: 'Server administration' });
  const [channelEdit, setChannelEdit] = useState({ channelId: '', name: '', parentId: '', topic: '' });
  const [archiveCategoryId, setArchiveCategoryId] = useState('');
  const [logChannelId, setLogChannelId] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!state.data) return;
    const settings = state.data[1].settings?.moderation ?? {};
    setArchiveCategoryId(settings.archiveCategoryId ?? '');
    setLogChannelId(settings.logChannelId ?? '');
  }, [state.data]);
  if (state.loading || state.error) return <Status state={state} />;
  const [roles, channels] = state.data;
  const roleList = roles.roles.filter((role) => role.id !== roles.bot?.roleId && role.name !== '@everyone');
  const categoryList = channels.channels.filter((channel) => channel.type === 4);
  const update = (setter, name) => (event) => setter((current) => ({ ...current, [name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  async function previewAndExecuteRole() {
    const memberIds = roleForm.memberIds.split(',').map((id) => id.trim()).filter(Boolean);
    const preview = await api('/admin/server/role-operations/preview', { method: 'POST', body: JSON.stringify({ action: roleForm.action, roleId: roleForm.roleId, memberIds }) });
    const phrase = window.prompt(`Preview: ${preview.affectedCount} members will be changed. Type exactly ${preview.confirmationPhrase}`);
    if (phrase !== preview.confirmationPhrase) return setNotice('Bulk operation cancelled.');
    await api('/admin/server/role-operations', { method: 'POST', body: JSON.stringify({ ...roleForm, memberIds, confirmPhrase: phrase, clientRequestId: crypto.randomUUID() }) });
    setNotice('Bulk role operation completed and audited.');
    setRevision((value) => value + 1);
  }
  async function searchServerMembers() {
    const result = await api(`/admin/server/members?query=${encodeURIComponent(memberQuery)}`);
    setMemberResults(result);
  }
  function selectServerMember(member) {
    setRoleForm((current) => ({ ...current, memberIds: [...new Set([...current.memberIds.split(',').map((id) => id.trim()).filter(Boolean), member.id])].join(',') }));
  }
  async function createRole() {
    if (!window.confirm(`Create role ${roleEdit.name}?`)) return;
    await api('/admin/server/roles', { method: 'POST', body: JSON.stringify({ ...roleEdit, color: Number(roleEdit.color), reason: 'Create role from Leone admin', confirm: true, clientRequestId: crypto.randomUUID() }) });
    setNotice('Role created.'); setRevision((value) => value + 1);
  }
  async function saveRole() {
    if (!roleEdit.roleId) return setNotice('Select a role to edit.');
    await api(`/admin/server/roles/${roleEdit.roleId}`, { method: 'PATCH', body: JSON.stringify({ name: roleEdit.name, color: Number(roleEdit.color), hoist: roleEdit.hoist, mentionable: roleEdit.mentionable, reason: 'Edit role from Leone admin', confirm: true, clientRequestId: crypto.randomUUID() }) });
    setNotice('Role metadata updated.'); setRevision((value) => value + 1);
  }
  async function createChannel() {
    await api('/admin/server/channels', { method: 'POST', body: JSON.stringify({ ...channelForm, type: Number(channelForm.type), parentId: channelForm.parentId || null, reason: channelForm.reason, confirm: true, clientRequestId: crypto.randomUUID() }) });
    setNotice('Channel created.'); setRevision((value) => value + 1);
  }
  async function saveChannel() {
    if (!channelEdit.channelId) return setNotice('Select a channel to edit.');
    await api(`/admin/server/channels/${channelEdit.channelId}`, { method: 'PATCH', body: JSON.stringify({ name: channelEdit.name, parentId: channelEdit.parentId || null, topic: channelEdit.topic || null, reason: 'Edit channel from Leone admin', confirm: true, clientRequestId: crypto.randomUUID() }) });
    setNotice('Channel updated.'); setRevision((value) => value + 1);
  }
  async function archiveChannel(channel) {
    if (!archiveCategoryId) return setNotice('Select an archive category first.');
    if (!window.confirm(`Lock and move #${channel.name} to the archive category?`)) return;
    await api(`/admin/server/channels/${channel.id}/archive`, { method: 'POST', body: JSON.stringify({ archiveCategoryId, reason: 'Archive channel from Leone admin', confirm: true, clientRequestId: crypto.randomUUID() }) });
    setNotice(`Channel #${channel.name} archived.`); setRevision((value) => value + 1);
  }
  async function saveSettings() {
    if (!canConfig) return;
    await api('/admin/config', { method: 'PATCH', body: JSON.stringify({ settings: { moderation: { archiveCategoryId, logChannelId, discordLogEnabled: Boolean(logChannelId) } } }) });
    setNotice('Moderation channel settings saved.');
  }
  return <section><header><p className="eyebrow">Roles, members, and channels</p><h1>Server administration</h1></header>{notice && <div className="notice">{notice}</div>}
    <Panel title="Bulk member-role operation"><div className="form-grid"><label>Action<select value={roleForm.action} onChange={update(setRoleForm, 'action')}><option value="assign">Assign role</option><option value="remove">Remove role</option></select></label><label>Role<select value={roleForm.roleId} onChange={update(setRoleForm, 'roleId')}><option value="">Select manageable role</option>{roleList.filter((role) => !role.managed).map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label><label>Member IDs (comma separated)<textarea rows="2" value={roleForm.memberIds} onChange={update(setRoleForm, 'memberIds')} placeholder="Search below or paste IDs, maximum 100" /></label><label>Reason<input value={roleForm.reason} onChange={update(setRoleForm, 'reason')} /></label></div><div className="actions"><input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Search member" /><button className="secondary" onClick={searchServerMembers}>Search</button></div>{memberResults.length > 0 && <div className="tags">{memberResults.map((member) => <button className="tag" key={member.id} onClick={() => selectServerMember(member)}>{member.displayName} ({member.id})</button>)}</div>}<button onClick={previewAndExecuteRole} disabled={!roleForm.roleId || !roleForm.memberIds}>Preview and execute</button></Panel>
    <Panel title="Role metadata"><div className="form-grid"><label>Existing role<select value={roleEdit.roleId} onChange={(event) => { const role = roleList.find((item) => item.id === event.target.value); setRoleEdit({ roleId: role?.id ?? '', name: role?.name ?? '', color: role?.color ?? 0, hoist: false, mentionable: false }); }}><option value="">Select role</option>{roleList.filter((role) => !role.managed).map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label><label>Name<input value={roleEdit.name} onChange={update(setRoleEdit, 'name')} /></label><label>Color integer<input type="number" min="0" max="16777215" value={roleEdit.color} onChange={update(setRoleEdit, 'color')} /></label><label className="checkbox"><input type="checkbox" checked={roleEdit.hoist} onChange={update(setRoleEdit, 'hoist')} /> Hoist</label><label className="checkbox"><input type="checkbox" checked={roleEdit.mentionable} onChange={update(setRoleEdit, 'mentionable')} /> Mentionable</label></div><div className="actions"><button className="secondary" onClick={createRole} disabled={!roleEdit.name}>Create role</button><button onClick={saveRole} disabled={!roleEdit.roleId}>Save metadata</button></div><DataTable rows={roleList} columns={['name','position','managed']} /></Panel>
    <Panel title="Channels"><div className="form-grid"><label>Type<select value={channelForm.type} onChange={update(setChannelForm, 'type')}><option value="0">Text</option><option value="5">Announcement</option><option value="15">Forum</option><option value="2">Voice</option><option value="13">Stage</option></select></label><label>Name<input value={channelForm.name} onChange={update(setChannelForm, 'name')} /></label><label>Parent category<select value={channelForm.parentId} onChange={update(setChannelForm, 'parentId')}><option value="">No category</option>{categoryList.map((channel) => <option value={channel.id} key={channel.id}>{channel.name}</option>)}</select></label><label>Topic<input value={channelForm.topic} onChange={update(setChannelForm, 'topic')} /></label></div><button onClick={createChannel} disabled={!channelForm.name}>Create channel</button><div className="mapping-row"><div className="form-grid"><label>Edit channel<select value={channelEdit.channelId} onChange={(event) => { const channel = channels.channels.find((item) => item.id === event.target.value); setChannelEdit({ channelId: channel?.id ?? '', name: channel?.name ?? '', parentId: channel?.parentId ?? '', topic: '' }); }}><option value="">Select channel</option>{channels.channels.filter((channel) => channel.type !== 4).map((channel) => <option value={channel.id} key={channel.id}>#{channel.name}</option>)}</select></label><label>Name<input value={channelEdit.name} onChange={update(setChannelEdit, 'name')} /></label><label>Parent category<select value={channelEdit.parentId} onChange={update(setChannelEdit, 'parentId')}><option value="">No category</option>{categoryList.map((channel) => <option value={channel.id} key={channel.id}>{channel.name}</option>)}</select></label><label>Topic<input value={channelEdit.topic} onChange={update(setChannelEdit, 'topic')} /></label></div><button onClick={saveChannel} disabled={!channelEdit.channelId}>Save channel</button></div><div className="table-wrap"><table><thead><tr><th>Channel</th><th>Type</th><th>Action</th></tr></thead><tbody>{channels.channels.filter((channel) => channel.type !== 4).map((channel) => <tr key={channel.id}><td>#{channel.name}</td><td>{channel.type}</td><td><button className="danger" onClick={() => archiveChannel(channel)}>Archive</button></td></tr>)}</tbody></table></div></Panel>
    <Panel title="Administration destinations"><div className="form-grid"><label>Archive category<select value={archiveCategoryId} onChange={(event) => setArchiveCategoryId(event.target.value)}><option value="">Select category</option>{categoryList.map((channel) => <option value={channel.id} key={channel.id}>{channel.name}</option>)}</select></label><label>Moderation log channel<select value={logChannelId} onChange={(event) => setLogChannelId(event.target.value)}><option value="">Disabled</option>{channels.channels.filter((channel) => [0,5].includes(channel.type)).map((channel) => <option value={channel.id} key={channel.id}>#{channel.name}</option>)}</select></label></div>{canConfig && <button onClick={saveSettings}>Save destinations</button>}</Panel>
  </section>;
}

function Audit() {
  const state = useLoad(() => api('/admin/audit'), []);
  if (state.loading || state.error) return <Status state={state} />;
  return <section><header><p className="eyebrow">Append-only operational evidence</p><h1>Audit log</h1></header><Panel title="Recent events"><DataTable rows={state.data} columns={['created_at','actor','action','target_category','result']} formatters={{ created_at: formatAuditTimestamp }} /></Panel></section>;
}

const auditTimestampFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function formatAuditTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? '—');
  const parts = Object.fromEntries(auditTimestampFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.day} ${parts.month} ${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function Panel({ title, children }) { return <article className="panel"><h2>{title}</h2>{children}</article>; }
function DataTable({ rows, columns, formatters = {} }) {
  if (!rows?.length) return <div className="empty">No records yet.</div>;
  const formatCell = (key, value, row) => formatters[key] ? formatters[key](value, row) : value == null ? '—' : typeof value === 'boolean' ? String(value) : String(value).slice(0, 120);
  return <div className="table-wrap"><table><thead><tr>{columns.map((key) => <th key={key}>{key.replaceAll('_',' ')}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? index}>{columns.map((key) => <td key={key}>{formatCell(key, row[key], row)}</td>)}</tr>)}</tbody></table></div>;
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
  const pages = { overview: <Overview />, family: <Family me={me} />, config: <Config canWrite={allowed('config.write')} />, greetings: <Greetings />, moderation: <Moderation />, 'server-admin': <ServerAdmin canConfig={allowed('config.write')} />, chatbot: <Chatbot />, audit: <Audit /> };
  return <div className="shell"><aside><div className="brand"><img className="crest-logo small" src={leoneLogo} alt="Leone" /><div><strong>Leone</strong><span>Royal companion</span></div></div><nav>{nav.filter((item) => allowed(item[2])).map(([key,label]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => { setPage(key); history.replaceState(null, '', key === 'family' ? `/family/${me.user.id}` : `/admin/${key}`); }}>{label}</button>)}</nav><div className="identity"><strong>{me.user.displayName}</strong><span>{me.owner ? 'Guild owner' : 'Kingdom member'}</span><button className="secondary logout" onClick={logout}>Sign out</button></div></aside><main>{pages[page] ?? pages.overview}</main></div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
