import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const host = '127.0.0.1';
const port = Number(process.env.PORT || 4317);
const origin = `http://${host}:${port}`;
const modelApiKey = process.env.LOOP_MODEL_API_KEY;
const modelKeyOrigin = process.env.LOOP_MODEL_API_KEY_ORIGIN;
const dataDirectory = resolve(process.env.LOOP_DATA_DIR || 'local-data');
const database = join(dataDirectory, 'state.json');
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });

const demo = { mode: 'demo', model: '', endpoint: '' };
const now = () => new Date().toISOString();
const problem = (message, status = 400) => Object.assign(new Error(message), { status });
const id = () => randomUUID();
const topics = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const text = (value, label, max = 300) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw problem(`${label} is required and must be at most ${max} characters.`);
  }
  return value.trim();
};
const topic = (value) => {
  if (typeof value !== 'string' || !topics.test(value)) {
    throw problem('Use a topic with up to 80 letters, digits, dots, underscores, or hyphens.');
  }
  return value;
};

function initialState() {
  const timestamp = Date.now();
  return {
    model: { ...demo },
    events: [
      { id: id(), topic: 'inbox.received', payload: { subject: 'Weekly product notes', body: 'A short update is ready for review.' }, source: 'Demo', createdAt: new Date(timestamp - 120000).toISOString() },
      { id: id(), topic: 'project.updated', payload: { project: 'Studio', status: 'Ready for review' }, source: 'Demo', createdAt: new Date(timestamp - 900000).toISOString() },
      { id: id(), topic: 'digest.requested', payload: { period: 'Today' }, source: 'Demo', createdAt: new Date(timestamp - 2400000).toISOString() }
    ],
    loops: [
      { id: id(), name: 'Inbox triage', topic: 'inbox.received', prompt: 'Summarize the event and suggest a next step.', outputTopic: '', active: true },
      { id: id(), name: 'Project summary', topic: 'project.updated', prompt: 'Summarize the project update in two sentences.', outputTopic: '', active: true },
      { id: id(), name: 'Digest check', topic: 'digest.requested', prompt: 'Describe the requested digest period.', outputTopic: '', active: true }
    ],
    schedules: [
      { id: id(), name: 'Daily digest', topic: 'digest.requested', payload: { period: 'Today' }, minutes: 1440, nextAt: timestamp + 1440 * 60000, active: true }
    ],
    runs: []
  };
}

let state;
try {
  state = JSON.parse(readFileSync(database, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  state = initialState();
}

function commit(change) {
  const draft = structuredClone(state);
  const result = change(draft);
  const temporary = database + '.tmp';
  writeFileSync(temporary, JSON.stringify(draft, null, 2), { mode: 0o600 });
  renameSync(temporary, database);
  state = draft;
  return result;
}

function enqueue(draft, event, loop) {
  draft.runs.unshift({
    id: id(), eventId: event.id, topic: event.topic, payload: event.payload,
    depth: event.depth || 0, loopName: loop.name, prompt: loop.prompt,
    outputTopic: loop.outputTopic, model: { ...draft.model }, status: 'queued', createdAt: now()
  });
}

function publish(draft, event, source, depth = 0) {
  const record = { id: id(), ...event, source, depth, createdAt: now() };
  draft.events.unshift(record);
  if (depth < 8) {
    for (const loop of draft.loops) {
      if (loop.active && loop.topic === record.topic) enqueue(draft, record, loop);
    }
  }
  return record;
}

commit((draft) => {
  for (const run of draft.runs) {
    if (run.status === 'running') {
      Object.assign(run, { status: 'failed', error: 'The server stopped during this run.', finishedAt: now() });
    }
  }
});

async function execute(run) {
  if (run.model.mode === 'demo') {
    return JSON.stringify({ message: `Demo received ${run.topic}`, payload: run.payload }, null, 2);
  }
  const key = new URL(run.model.endpoint).origin === modelKeyOrigin ? modelApiKey : undefined;
  const response = await fetch(run.model.endpoint.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model: run.model.model,
      messages: [
        { role: 'system', content: run.prompt },
        { role: 'user', content: JSON.stringify({ topic: run.topic, payload: run.payload }) }
      ]
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(90000)
  });
  if (!response.ok) throw new Error(`Model endpoint returned HTTP ${response.status}.`);
  const result = (await response.json()).choices?.[0]?.message?.content;
  if (typeof result !== 'string' || !result.trim()) throw new Error('The model did not return a text response.');
  return result;
}

let working = false;
async function drain() {
  if (working) return;
  working = true;
  try {
    while (true) {
      const queued = state.runs.findLast((run) => run.status === 'queued');
      if (!queued) break;
      commit((draft) => { draft.runs.find((run) => run.id === queued.id).status = 'running'; });
      let result;
      try {
        result = { status: 'completed', output: await execute(queued) };
      } catch (error) {
        result = { status: 'failed', error: error.message };
      }
      commit((draft) => {
        Object.assign(draft.runs.find((run) => run.id === queued.id), result, { finishedAt: now() });
        if (result.status === 'completed' && queued.outputTopic && queued.depth < 8) {
          publish(draft, {
            topic: queued.outputTopic, payload: { output: result.output, runId: queued.id, eventId: queued.eventId }
          }, queued.loopName, queued.depth + 1);
        }
      });
    }
  } finally {
    working = false;
  }
}

function wake() {
  drain().catch((error) => console.error('Worker:', error.message));
}

function tick() {
  const time = Date.now();
  if (!state.schedules.some((schedule) => schedule.active && schedule.nextAt <= time)) return;
  commit((draft) => {
    for (const schedule of draft.schedules) {
      if (!schedule.active || schedule.nextAt > time) continue;
      const interval = schedule.minutes * 60000;
      schedule.nextAt += (Math.floor((time - schedule.nextAt) / interval) + 1) * interval;
      publish(draft, { topic: schedule.topic, payload: schedule.payload }, schedule.name);
    }
  });
}

function requiredObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem('Expected a JSON object.');
  return value;
}

async function readJSON(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw problem('Use Content-Type: application/json.', 415);
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= 262144) chunks.push(chunk);
  }
  if (size > 262144) throw problem('Request exceeds 256 KiB.', 413);
  try {
    return requiredObject(JSON.parse(Buffer.concat(chunks).toString()));
  } catch {
    throw problem('Send a valid JSON object.');
  }
}

function eventInput(body) {
  return { topic: topic(body.topic), payload: requiredObject(body.payload ?? {}) };
}

function saveModel(body) {
  if (body.mode === 'demo') return { ...demo };
  if (body.mode !== 'compatible') throw problem('Choose a supported model provider.');
  let endpoint;
  try {
    endpoint = new URL(body.endpoint);
  } catch {
    throw problem('Enter a valid model base URL.');
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
  if ((endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:')) ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      endpoint.pathname.replace(/\/+$/, '').endsWith('/chat/completions')) {
    throw problem('Use an HTTPS base URL, or HTTP on loopback. Omit credentials, query strings, and /chat/completions.');
  }
  return { mode: 'compatible', endpoint: endpoint.href, model: text(body.model, 'Model name') };
}

function api(method, path, body) {
  if (method === 'GET' && path === '/api/state') {
    return {
      ...state,
      hasApiKey: Boolean(state.model.endpoint && modelApiKey && new URL(state.model.endpoint).origin === modelKeyOrigin),
      runs: state.runs.map(({ prompt, model, payload, ...run }) => run)
    };
  }
  if (method === 'PUT' && path === '/api/model') {
    return commit((draft) => { draft.model = saveModel(body); return draft.model; });
  }
  if (method === 'POST' && path === '/api/events') {
    return commit((draft) => publish(draft, eventInput(body), 'Manual / API'));
  }

  const match = /^\/api\/(loops|schedules)(?:\/([\w-]+))?(?:\/(emit))?$/.exec(path);
  if (!match) throw problem('Route not found.', 404);
  const [, collection, identifier, action] = match;
  return commit((draft) => {
    const records = draft[collection];
    const existing = records.find((record) => record.id === identifier);
    if (identifier && !existing) throw problem('Record not found.', 404);
    if (method === 'POST' && action === 'emit' && collection === 'schedules') {
      return publish(draft, { topic: existing.topic, payload: existing.payload }, existing.name);
    }
    if (identifier && !action && method === 'PATCH' && typeof body.active === 'boolean') {
      existing.active = body.active;
      if (collection === 'schedules' && existing.active) existing.nextAt = Date.now() + existing.minutes * 60000;
      return existing;
    }
    if (action || !((method === 'POST' && !identifier) || (method === 'PUT' && identifier))) {
      throw problem('Method not allowed.', 405);
    }
    const record = {
      id: identifier || id(), name: text(body.name, 'Name', 80),
      topic: topic(body.topic), active: existing?.active ?? true
    };
    if (collection === 'loops') {
      record.prompt = text(body.prompt, 'Model instruction', 12000);
      record.outputTopic = body.outputTopic ? topic(body.outputTopic) : '';
      if (record.outputTopic === record.topic) throw problem('Choose a different output topic to avoid a self-trigger.');
    } else {
      if (!Number.isInteger(body.minutes) || body.minutes < 1 || body.minutes > 525600) {
        throw problem('Enter a whole interval from 1 to 525600 minutes.');
      }
      Object.assign(record, eventInput(body), {
        minutes: body.minutes,
        nextAt: existing?.minutes === body.minutes ? existing.nextAt : Date.now() + body.minutes * 60000
      });
    }
    if (existing) records[records.indexOf(existing)] = record;
    else records.unshift(record);
    return record;
  });
}

const assets = new Map([
  ['/', ['app/index.html', 'text/html']],
  ['/app.js', ['app/app.js', 'text/javascript']],
  ['/style.css', ['app/style.css', 'text/css']],
  ['/project', ['site/index.html', 'text/html']],
  ['/project/', ['site/index.html', 'text/html']],
  ['/project/site.css', ['site/site.css', 'text/css']]
]);

createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  try {
    if (request.headers.host !== `${host}:${port}` ||
        (request.headers.origin && request.headers.origin !== origin) ||
        request.headers['sec-fetch-site'] === 'cross-site') throw problem('Use the printed local URL.', 403);
    const path = new URL(request.url, origin).pathname;
    if (path.startsWith('/api/')) {
      const method = request.method;
      const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readJSON(request) : {};
      const data = api(method, path, body);
      response.writeHead(method === 'POST' ? 201 : 200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(data));
      wake();
      return;
    }
    const asset = request.method === 'GET' && assets.get(path);
    if (!asset) throw problem('Page not found.', 404);
    const content = readFileSync(new URL(asset[0], import.meta.url));
    response.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8' });
    response.end(content);
  } catch (error) {
    if (!error.status) console.error(error);
    response.writeHead(error.status || 500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: error.status ? error.message : 'Loop could not complete the request.' }));
  }
}).listen(port, host, () => {
  console.log(`Loop Studio · ${origin}\nProject page · ${origin}/project/`);
  setInterval(() => {
    try { tick(); wake(); } catch (error) { console.error('Scheduler:', error.message); }
  }, 1000).unref();
  wake();
});
