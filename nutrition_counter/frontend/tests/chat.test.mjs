import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const code = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

// A minimal DOM lets the request lifecycle be tested without a browser dependency.
// Layout, focus placement and native dialog behavior still require browser QA.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.style = {};
    this.dataset = {}; this.attributes = {}; this.listeners = {};
    this.value = ''; this.disabled = false; this.hidden = false;
    this.className = ''; this.scrollHeight = 27;
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(' '), ...names])].join(' '); },
      remove: name => { this.className = this.className.split(' ').filter(value => value !== name).join(' '); },
      contains: name => this.className.split(' ').includes(name),
      toggle: name => { const active = !this.classList.contains(name); this.classList[active ? 'add' : 'remove'](name); return active; }
    };
  }
  append(...children) { children.forEach(child => { child.parent = this; this.children.push(child); }); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; if (name === 'href') delete this.href; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  querySelector(selector) { return this.descendants().find(child => child.classList.contains(selector.slice(1))); }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  focus() {} scrollIntoView() {} setCustomValidity() {} reportValidity() {}
  showModal() { this.open = true; } close() { this.open = false; }
  set innerHTML(value) { throw new Error('Unsafe HTML assignment'); }
}

function harness(fixtures = {}) {
  const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [`#${match[1]}`, new Element()]));
  const suggestions = Array.from({ length: 4 }, () => new Element('button'));
  const requests = [], timers = new Map(); let nextTimer = 0, knowledgeCalls = 0;
  const document = {
    body: new Element('body'), querySelector: selector => nodes[selector],
    querySelectorAll: selector => selector === '.suggestion' ? suggestions : [],
    createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag),
    createTextNode: text => { const node = new Element('text'); node.textContent = text; return node; }, addEventListener() {}
  };
  const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
  const fetch = async (path, options) => {
    if (path === '/api/chat') return new Promise(resolve => { requests.push({ options, resolve: (data, status) => resolve(response(data, status)) }); });
    if (path === '/api/chat/status') return response({ configured: false, documents: 3, model: 'test-model' });
    if (path === '/api/profile') return response({ calories: 2100, protein: 120 });
    if (path === '/api/knowledge') {
      knowledgeCalls++;
      if (knowledgeCalls <= (fixtures.knowledgeFailures || 0)) return response({ detail: { message: 'Временная ошибка базы' } }, 503);
      return response(fixtures.knowledge || []);
    }
    if (path === '/api/meals') return response(fixtures.meals || []);
    return response([]);
  };
  const context = vm.createContext({ document, fetch, AbortController, URL, console, TypeError,
    matchMedia: () => ({ matches: true }), window: { scrollTo() {} },
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id) });
  vm.runInContext(code, context);
  return { nodes, requests, timers, run: script => vm.runInContext(script, context) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const answer = { intro: 'Ответ по источникам', items: [], end: '', sources: [], mode: 'no_context', passages: [] };

test('reset cancels the request and an older completion cannot unlock or render into a newer conversation', async () => {
  const h = harness(); await settle();
  const first = h.run('ask("Первый вопрос")');
  h.run('resetChat()');
  assert.equal(h.requests[0].options.signal.aborted, true);
  const second = h.run('ask("Второй вопрос")');
  h.requests[0].resolve(answer); await first;
  assert.equal(h.nodes['#question'].disabled, true);
  assert.equal(h.nodes['#conversation'].children.length, 2);
  h.requests[1].resolve(answer); await second;
  assert.equal(h.nodes['#question'].disabled, false);
  assert.equal(h.nodes['#conversation'].children.length, 2);
  assert.equal(h.nodes['#conversation'].attributes['aria-busy'], 'false');
});

test('duplicate submissions are blocked and reset keeps a late response off the welcome screen', async () => {
  const h = harness(); await settle();
  const pending = h.run('ask("Вопрос")');
  await h.run('ask("Повторный вопрос")');
  assert.equal(h.requests.length, 1);
  h.run('resetChat()');
  h.requests[0].resolve(answer); await pending;
  assert.equal(h.nodes['#conversation'].children.length, 0);
  assert.equal(h.nodes['#welcome'].hidden, false);
});

test('server errors are readable and retry sends the same question including line breaks', async () => {
  const h = harness(); await settle();
  const pending = h.run(`ask(${JSON.stringify('Вопрос о белке\nи перекусе')})`);
  h.requests[0].resolve({ detail: { code: 'quota_exceeded', message: 'Лимит запросов Gemini исчерпан.' } }, 429);
  await pending;
  const body = h.nodes['#conversation'].children.at(-1).children.at(-1);
  assert.match(body.children[0].textContent, /Лимит запросов/);
  body.children[1].listeners.click();
  assert.equal(JSON.parse(h.requests[1].options.body).question, 'Вопрос о белке\nи перекусе');
  h.requests[1].resolve(answer); await settle();
});

test('source links allow HTTPS only and source text is rendered literally', async () => {
  const h = harness(); await settle();
  h.run(`sources.test = { id:'test', title:'<img src=x>', description:'<script>bad()</script>', content:'<b>Текст</b>', url:'javascript:alert(1)' }; showSourceModal('test');`);
  assert.equal(h.nodes['#source-original'].hidden, true);
  assert.equal(h.nodes['#source-title'].textContent, '<img src=x>');
  assert.equal(h.nodes['#source-content'].textContent, '<b>Текст</b>');
  h.run(`sources.test.url='https://www.who.int/example'; showSourceModal('test');`);
  assert.equal(h.nodes['#source-original'].hidden, false);
  assert.equal(h.nodes['#source-original'].href, 'https://www.who.int/example');
});

test('retrieval and generated answers have distinct mode labels', async () => {
  const h = harness(); await settle();
  for (const [mode, label] of [['retrieval', 'НАЙДЕННЫЕ ФРАГМЕНТЫ'], ['gemini', 'GEMINI + ИСТОЧНИКИ']]) {
    const pending = h.run('ask("Какие продукты богаты белком?")');
    h.requests.at(-1).resolve({ ...answer, mode }); await pending;
    assert.equal(h.nodes['#conversation'].children.at(-1).querySelector('.mock-tag').textContent, label);
  }
});

const knowledgeFixtures = [
  { id: 'D03', title: 'Белковые продукты', publisher: 'Harvard', category: 'articles', description: 'О белке', content: 'Фасоль и чечевица содержат белок.', url: 'https://example.org/protein', bookmarked: false },
  { id: 'D08', title: 'Сахар в рационе', publisher: 'NHS', category: 'tips', description: 'Как уменьшить сахар', content: 'Взрослым рекомендуют ограничивать свободные сахара.', url: 'https://example.org/sugar', bookmarked: false },
];

test('both knowledge buttons open the full catalog separately from empty favorites; search uses IDs and full text', async () => {
  const h = harness({ knowledge: knowledgeFixtures }); await settle();
  h.nodes['#sources-nav'].listeners.click();
  assert.equal(h.nodes['#knowledge-view'].hidden, false);
  assert.equal(h.nodes['#favorites-view'].hidden, true);
  assert.equal(h.nodes['#knowledge-grid'].attributes['aria-busy'], 'true');
  await settle();
  assert.equal(h.nodes['#knowledge-grid'].children.length, 2);
  assert.equal(h.nodes['#knowledge-status'].textContent, 'Показано 2 из 2 материалов');
  h.nodes['#knowledge-search'].value = 'd08';
  h.nodes['#knowledge-search'].listeners.input();
  assert.equal(h.nodes['#knowledge-grid'].children.length, 1);
  assert.match(h.nodes['#knowledge-grid'].children[0].children[0].textContent, /D08/);
  h.nodes['#knowledge-grid'].children[0].querySelector('.secondary-btn').listeners.click();
  assert.equal(h.nodes['#source-title'].textContent, 'Сахар в рационе');
  assert.equal(h.nodes['#source-full-text'].open, true);
  h.nodes['#knowledge-search'].value = 'чечевица';
  h.nodes['#knowledge-search'].listeners.input();
  assert.match(h.nodes['#knowledge-grid'].children[0].children[0].textContent, /D03/);
  h.run(`switchView('favorites')`);
  assert.equal(h.nodes['#favorites-view'].hidden, false);
  h.nodes['#top-sources'].listeners.click();
  assert.equal(h.nodes['#knowledge-view'].hidden, false);
  assert.equal(h.nodes['#favorites-view'].hidden, true);
});

test('knowledge catalog reports a failed load and can retry, then shows an honest empty search', async () => {
  const h = harness({ knowledge: knowledgeFixtures, knowledgeFailures: 1 }); await settle();
  h.nodes['#sources-nav'].listeners.click(); await settle();
  assert.equal(h.nodes['#knowledge-status'].textContent, 'Не удалось загрузить базу знаний.');
  const retry = h.nodes['#knowledge-grid'].children[0].children.at(-1);
  retry.listeners.click(); await settle();
  assert.equal(h.nodes['#knowledge-grid'].children.length, 2);
  h.nodes['#knowledge-search'].value = 'неизвестный_термин';
  h.nodes['#knowledge-search'].listeners.input();
  assert.equal(h.nodes['#knowledge-status'].textContent, 'Показано 0 из 2 материалов');
  assert.equal(h.nodes['#knowledge-grid'].children[0].children[0].textContent, 'Ничего не найдено');
});

test('catalog bookmarks update the existing source and favorites without requiring a saved item first', async () => {
  const h = harness({ knowledge: knowledgeFixtures }); await settle();
  h.nodes['#sources-nav'].listeners.click(); await settle();
  const save = h.nodes['#knowledge-grid'].children[0].querySelector('.knowledge-save-button');
  await save.listeners.click();
  assert.equal(h.run(`sources.D03.bookmarked`), true);
  assert.equal(save.attributes['aria-pressed'], 'true');
  assert.equal(save.textContent, 'Сохранено');
  h.run(`switchView('favorites')`);
  assert.equal(h.nodes['#favorites-grid'].children[0].children[1].textContent, 'Белковые продукты');
});

test('diary analysis explicitly sends diary scope; ordinary chat stays general and retry preserves scope', async () => {
  const h = harness({ meals: [{ id: 'm1', meal: 'lunch', name: 'Тестовое блюдо', cals: 500, protein: 20, fat: 10, carbs: 50, weight: 200 }] }); await settle();
  h.nodes['#ask-about-stats-btn'].listeners.click();
  assert.equal(h.nodes['#chat-view'].hidden, false);
  assert.equal(h.nodes['#ask-about-stats-btn'].disabled, true);
  assert.equal(JSON.parse(h.requests[0].options.body).scope, 'diary');
  assert.deepEqual(Object.keys(JSON.parse(h.requests[0].options.body)).sort(), ['question', 'scope']);
  h.requests[0].resolve({ detail: { message: 'Повторите позже' } }, 503); await settle();
  const retry = h.nodes['#conversation'].children.at(-1).children.at(-1).children[1];
  retry.listeners.click();
  assert.equal(JSON.parse(h.requests[1].options.body).scope, 'diary');
  h.requests[1].resolve({ ...answer, diary_summary: { record_count: 1, totals: { calories: 500, protein: 20, fat: 10, carbs: 50 }, targets: { calories: 2100, protein: 120 }, scope_note: 'Все текущие записи' } }); await settle();
  const snapshot = h.nodes['#conversation'].children.at(-1).querySelector('.diary-reply-summary');
  assert.match(snapshot.children[1].textContent, /500/);
  const plain = h.run(`ask('Что такое белок?')`);
  assert.equal(JSON.parse(h.requests[2].options.body).scope, 'general');
  h.requests[2].resolve(answer); await plain;
});

test('empty diary analysis explains the next action without a needless LLM request', async () => {
  const h = harness(); await settle();
  h.run(`switchView('stats')`);
  h.nodes['#ask-about-stats-btn'].listeners.click();
  assert.equal(h.requests.length, 0);
  assert.equal(h.nodes['#diary-analysis-status'].hidden, false);
  assert.match(h.nodes['#diary-analysis-status'].textContent, /добавьте хотя бы одно блюдо/);
});
