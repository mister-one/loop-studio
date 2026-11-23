const icons = {
  overview: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.2"/>',
  events: '<path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/>',
  loops: '<path d="M20 7H7a4 4 0 0 0-4 4m14-7 3 3-3 3M4 17h13a4 4 0 0 0 4-4m-14 7-3-3 3-3"/>',
  schedules: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  runs: '<path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 4v4m8 2v4m-7 2v4"/>',
  model: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const pages = { overview: 'Overview', events: 'Events', loops: 'Loops', schedules: 'Schedules', runs: 'Runs', model: 'Model' };
const main = document.querySelector('#main');
const dialog = document.querySelector('#dialog');
const dialogBody = document.querySelector('#dialog-body');
const nav = document.querySelector('#nav');
const notice = document.querySelector('#notice');
let state;
let serialized;
let noticeTimer;

const escape = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
const date = (value) => new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
}).format(new Date(value));
const pretty = (value) => JSON.stringify(value, null, 2);
const pill = (status) => `<span class="pill ${status}"><span class="dot"></span>${status}</span>`;
const blank = (value) => `<p class="empty">${value}</p>`;
const row = (label, type, value, meta) => `<div class="metric"><span class="metric-icon ${type}">${icon(type)}</span><div class="metric-title">${label}</div><strong>${value}</strong><small>${meta}</small></div>`;
const button = (label, action, id = '', style = 'secondary') => `<button class="${style}" type="button" data-action="${action}" data-id="${escape(id)}">${label}</button>`;

async function request(path, method = 'GET', body) {
  const response = await fetch('/api/' + path, {
    method,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed.');
  return data;
}

function announce(message) {
  notice.textContent = message;
  notice.classList.add('visible');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.remove('visible'), 3600);
}

function eventRows(events) {
  if (!events.length) return blank('Emit an event to start the stream.');
  return `<div class="table-wrap"><table><thead><tr><th scope="col">Topic</th><th scope="col">Source</th><th scope="col">Received</th></tr></thead><tbody>
    ${events.map((event) => `<tr><td><button type="button" class="event-link" data-action="inspect-event" data-id="${escape(event.id)}"><span class="event-icon">${icon('events')}</span><code>${escape(event.topic)}</code></button></td><td>${escape(event.source)}</td><td><time datetime="${escape(event.createdAt)}">${date(event.createdAt)}</time></td></tr>`).join('')}
  </tbody></table></div>`;
}

function header(title, summary, action = '') {
  return `<div class="page-title"><div><h1>${title}</h1><p>${summary}</p></div>${action}</div>`;
}

function overview() {
  const activeLoops = state.loops.filter((loop) => loop.active).length;
  const activeSchedules = state.schedules.filter((schedule) => schedule.active).length;
  const processing = state.runs.filter((run) => ['running', 'queued'].includes(run.status)).length;
  return `
    ${header('Overview', 'Manage what comes in and what runs next.')}
    <section class="hero">
      <div class="hero-copy">
        <span class="hero-label"><span class="dot"></span> Runtime online</span>
        <h2>Event workflows</h2>
        <p>Turn incoming events and recurring checks into model-powered workflows.</p>
        ${button('+ Create a loop', 'new-loops', '', 'hero-button')}
      </div>
      <div class="pipeline" aria-label="An event triggers a loop which can emit a result">
        <i class="trace trace-top"></i><i class="trace trace-bottom"></i>
        <div class="pipeline-node pipeline-in">${icon('events')}<span><small>Input</small>Event</span></div>
        <div class="pipeline-node pipeline-mid">${icon('loops')}<span><small>Process</small>Loop</span></div>
        <div class="pipeline-node pipeline-out">${icon('runs')}<span><small>Output</small>Result</span></div>
      </div>
    </section>
    <section class="metrics" aria-label="Workspace totals">
      ${row('Events received', 'events', state.events.length, 'In the event stream')}
      ${row('Active loops', 'loops', activeLoops, `Of ${state.loops.length} configured`)}
      ${row('Active schedules', 'schedules', activeSchedules, `Of ${state.schedules.length} configured`)}
      ${row('Runs', 'runs', state.runs.length, `${processing} in progress`)}
    </section>
    <div class="overview-grid">
      <section class="panel"><div class="panel-heading"><div><h2>Recent events</h2><p>Latest activity in your workspace</p></div><a href="#events">View events</a></div>${eventRows(state.events.slice(0, 5))}</section>
      <section class="panel"><div class="panel-heading"><div><h2>Runtime</h2><p>Current configuration</p></div></div>
        <div class="runtime-row"><span class="metric-icon model">${icon('model')}</span><div><small>Model</small><strong>${escape(state.model.mode === 'demo' ? 'Demo processor' : state.model.model)}</strong></div><a href="#model">Configure</a></div>
        <div class="runtime-row"><span class="metric-icon schedules">${icon('schedules')}</span><div><small>Scheduler</small><strong>Running locally</strong></div></div>
      </section>
    </div>`;
}

function collectionPage(key) {
  const loops = key === 'loops';
  return header(pages[key], loops ? 'Match an event topic and pass its payload to your model.' :
    'Publish events at recurring intervals, even with this tab closed.', button(loops ? '+ New loop' : '+ New schedule', 'new-' + key, '', 'primary')) +
    `<div class="records">${state[key].map((record) => `
    <article class="panel record">
      <span class="metric-icon ${key}">${icon(key)}</span>
      <div class="record-info"><h2>${escape(record.name)}</h2><code>${escape(record.topic)}</code>
        <p>${loops ? escape(record.prompt) : `Every ${record.minutes.toLocaleString()} min${record.active ? ' · Next ' + date(record.nextAt) : ''}`}</p>
      </div>${pill(record.active ? 'active' : 'paused')}
      <div class="record-actions">${loops ? '' : button('Emit now', 'emit-schedule', record.id)}
        ${button(record.active ? 'Pause' : 'Resume', 'toggle-' + key, record.id)}
        ${button('Edit', 'edit-' + key, record.id)}</div>
    </article>`).join('') || blank('Add your first ' + (loops ? 'loop.' : 'schedule.'))}</div>`;
}

function runsPage() {
  return header('Runs', 'Inspect model output and processing errors for each event.') + `
    <section class="panel">${state.runs.length ? `<div class="table-wrap"><table>
      <thead><tr><th scope="col">Loop</th><th scope="col">Event topic</th><th scope="col">Status</th><th scope="col">Created</th></tr></thead>
      <tbody>${state.runs.map((run) => `<tr><td>${button(escape(run.loopName), 'inspect-run', run.id, 'text-button')}</td><td><code>${escape(run.topic)}</code></td><td>${pill(run.status)}</td><td>${date(run.createdAt)}</td></tr>`).join('')}</tbody>
    </table></div>` : blank('Runs appear here when an event matches an active loop.')}</section>`;
}

function modelPage() {
  const isDemo = state.model.mode === 'demo';
  return header('Model', 'Choose how Loop processes events.') + `<section class="panel model-card">
    <span class="metric-icon model">${icon('model')}</span>
    <div><h2>${escape(isDemo ? 'Demo processor' : state.model.model)}</h2>
      <p>${isDemo ? 'Echoes sample event data so you can test the workflow locally.' : escape(state.model.endpoint)}</p>
      ${isDemo ? '' : `<p class="muted">${state.hasApiKey ? 'API key configured for this endpoint.' : 'No API key configured for this endpoint.'}</p>`}
    </div>${button('Configure model', 'configure', '', 'secondary')}
  </section>`;
}

function render() {
  const hash = location.hash.slice(1);
  const page = Object.hasOwn(pages, hash) ? hash : 'overview';
  document.querySelector('#breadcrumb').textContent = pages[page];
  nav.innerHTML = Object.entries(pages).map(([key, label]) =>
    `<a href="#${key}" ${page === key ? 'aria-current="page"' : ''}>${icon(key)}${label}</a>`
  ).join('');
  if (!state) return;
  const renderers = {
    overview, events: () => header('Events', 'Browse event payloads and see where they came from.') + `<section class="panel">${eventRows(state.events)}</section>`,
    loops: () => collectionPage('loops'), schedules: () => collectionPage('schedules'), runs: runsPage, model: modelPage
  };
  main.innerHTML = renderers[page]();
  main.setAttribute('aria-busy', 'false');
}

async function refresh() {
  const connection = document.querySelector('#connection');
  try {
    const data = await request('state');
    const next = JSON.stringify(data);
    state = data;
    connection.textContent = 'Local runtime';
    document.querySelector('#connection-dot').classList.add('online');
    if (next !== serialized) {
      serialized = next;
      const focused = document.activeElement;
      const focusAction = main.contains(focused) && focused.dataset.action;
      const focusId = focusAction && focused.dataset.id;
      render();
      if (focusAction) {
        [...main.querySelectorAll('[data-action]')].find((element) =>
          element.dataset.action === focusAction && element.dataset.id === focusId)?.focus({ preventScroll: true });
      }
    }
  } catch (error) {
    connection.textContent = 'Disconnected';
    document.querySelector('#connection-dot').classList.remove('online');
    if (!state) {
      main.textContent = error.message;
      main.setAttribute('aria-busy', 'false');
    }
  }
}

function open(title, content) {
  dialogBody.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">${title}</h2><button class="close" type="button" data-action="close" aria-label="Close">×</button></div>${content}`;
  if (!dialog.open) dialog.showModal();
}

function form(title, fields, label, submit) {
  open(title, `<form>${fields}<p class="form-error" role="alert" hidden></p><div class="form-footer">
    ${button('Cancel', 'close')}<button class="primary" type="submit">${label}</button></div></form>`);
  const element = dialog.querySelector('form');
  element.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = element.querySelector('[type="submit"]');
    const errorField = element.querySelector('.form-error');
    submitButton.disabled = true;
    errorField.hidden = true;
    try {
      const message = await submit(Object.fromEntries(new FormData(element)));
      dialog.close();
      announce(message);
      await refresh();
    } catch (error) {
      errorField.textContent = error.message;
      errorField.hidden = false;
    } finally {
      submitButton.disabled = false;
    }
  });
  element.querySelector('input, select, textarea')?.focus();
}

const input = (label, name, value = '', other = 'required') =>
  `<label class="field">${label}<input name="${name}" value="${escape(value)}" ${other}></label>`;
const area = (label, name, value) =>
  `<label class="field">${label}<textarea name="${name}" rows="5" required>${escape(value)}</textarea></label>`;

function payload(value) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error('Payload must be a valid JSON object.');
  }
}

function itemForm(key, existing) {
  const loops = key === 'loops';
  const kind = loops ? 'loop' : 'schedule';
  const fields = input('Name', 'name', existing?.name, 'required maxlength="80"') +
    input('Event topic', 'topic', existing?.topic, 'required placeholder="inbox.received"') +
    (loops ? area('Model instruction', 'prompt', existing?.prompt || 'Summarize the event and suggest a next step.') +
      input('Output topic (optional)', 'outputTopic', existing?.outputTopic, 'placeholder="inbox.summarized"') :
      input('Interval in minutes', 'minutes', existing?.minutes || 60, 'type="number" min="1" max="525600" required') +
      area('Event payload (JSON)', 'payload', pretty(existing?.payload || {})));
  form((existing ? 'Edit ' : 'New ') + kind, fields, 'Save ' + kind, async (data) => {
    if (!loops) Object.assign(data, { minutes: Number(data.minutes), payload: payload(data.payload) });
    await request(existing ? key + '/' + existing.id : key, existing ? 'PUT' : 'POST', data);
    return loops ? 'Loop saved.' : 'Schedule saved.';
  });
}

function configureForm() {
  const model = state.model;
  form('Configure model', `
    <label class="field">Provider<select name="mode"><option value="demo">Demo processor</option><option value="compatible">OpenAI-compatible endpoint</option></select></label>
    <fieldset><legend>Endpoint details</legend>${input('Base URL', 'endpoint', model.endpoint, 'type="url" required placeholder="http://127.0.0.1:11434/v1"')}
    ${input('Model name', 'model', model.model, 'required placeholder="Your model ID"')}
    <p class="muted">If your provider requires a key, set LOOP_MODEL_API_KEY and LOOP_MODEL_API_KEY_ORIGIN before starting Loop. Matching event payloads are sent to this endpoint.</p></fieldset>`,
  'Save model', async (data) => {
    await request('model', 'PUT', data);
    return 'Model saved.';
  });
  const select = dialog.querySelector('select');
  const fieldset = dialog.querySelector('fieldset');
  const update = () => { fieldset.hidden = fieldset.disabled = select.value === 'demo'; };
  select.value = model.mode;
  select.addEventListener('change', update);
  update();
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, id } = target.dataset;
  if (action === 'close') { dialog.close(); return; }
  if (action === 'event') {
    form('Emit an event', input('Topic', 'topic', 'inbox.received') +
      area('Payload (JSON)', 'payload', pretty({ subject: 'Hello Loop' })), 'Emit event', async (data) => {
      await request('events', 'POST', { ...data, payload: payload(data.payload) });
      return 'Event emitted.';
    });
    return;
  }
  if (!state) return;
  const [operation, key] = action.split('-');
  try {
    if (action === 'configure') configureForm();
    if (operation === 'new') itemForm(key);
    if (operation === 'edit') itemForm(key, state[key].find((record) => record.id === id));
    if (action === 'inspect-event') {
      const record = state.events.find((item) => item.id === id);
      open(escape(record.topic), `<p class="muted">${escape(record.source)} · ${date(record.createdAt)}</p><pre>${escape(pretty(record.payload))}</pre>`);
    }
    if (action === 'inspect-run') {
      const run = state.runs.find((item) => item.id === id);
      open(escape(run.loopName), `<p class="muted">${escape(run.topic)} · ${date(run.createdAt)}</p>${pill(run.status)}
        <pre>${escape(run.output || run.error || 'Waiting for the processor.')}</pre>`);
    }
    if (operation === 'emit') {
      target.disabled = true;
      await request('schedules/' + id + '/emit', 'POST', {});
      announce('Scheduled event emitted.');
      await refresh();
    }
    if (operation === 'toggle') {
      target.disabled = true;
      const record = state[key].find((item) => item.id === id);
      await request(key + '/' + id, 'PATCH', { active: !record.active });
      announce(record.active ? 'Paused.' : 'Resumed.');
      await refresh();
    }
  } catch (error) {
    announce(error.message);
  } finally {
    target.disabled = false;
  }
});

document.querySelector('#address').textContent = location.host;
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
render();
await refresh();
setInterval(refresh, 2000);
