// ── API Client ──
const API_BASE = '';  // Same origin; change to 'http://localhost:8000' if running separately

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok && res.status !== 204) {
    const payload = await res.json().catch(() => null);
    const detail = payload?.detail;
    const message = typeof detail === 'string' ? detail : detail?.message;
    const error = new Error(message || (res.status === 422
      ? 'Проверьте вопрос: он должен содержать от 1 до 2000 символов.'
      : `Сервер не смог обработать запрос (HTTP ${res.status}).`));
    error.status = res.status;
    throw error;
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── API functions ──

async function apiGetProfile() {
  return apiFetch('/api/profile');
}

async function apiUpdateProfile(data) {
  return apiFetch('/api/profile', { method: 'PUT', body: JSON.stringify(data) });
}

async function apiGetMeals() {
  return apiFetch('/api/meals');
}

async function apiCreateMeal(data) {
  return apiFetch('/api/meals', { method: 'POST', body: JSON.stringify(data) });
}

async function apiDeleteMeal(mealId) {
  return apiFetch(`/api/meals/${encodeURIComponent(mealId)}`, { method: 'DELETE' });
}

async function apiDeleteAllMeals() {
  return apiFetch('/api/meals', { method: 'DELETE' });
}

async function apiGetSources(signal) {
  return apiFetch('/api/sources', { signal });
}

async function apiGetKnowledge() {
  return apiFetch('/api/knowledge');
}

async function apiToggleBookmark(sourceId, bookmarked) {
  return apiFetch(`/api/sources/${encodeURIComponent(sourceId)}/bookmark`, {
    method: 'PATCH',
    body: JSON.stringify({ bookmarked }),
  });
}

async function apiGetFoods(query = '') {
  const params = query ? `?q=${encodeURIComponent(query)}` : '';
  return apiFetch(`/api/foods${params}`);
}

async function apiChat(question, signal, options = {}) {
  const scope = options.scope === 'diary' ? 'diary' : 'general';
  return apiFetch('/api/chat', { method: 'POST', body: JSON.stringify({ question, scope }), signal });
}

// Knowledge articles and retrieval results come from the backend.
const sourcePassages = new Map();

// FOOD DATASET — now loaded from API
let FOOD_DATASET = [];

// APP STATE
let sources = {};
let userProfile = {
  name: 'Алексей', age: 28, height: 178, weight: 74,
  goal: 'maintenance', calories: 2100, protein: 120,
  lactose: true, gluten: false, veg: false, sugar: false
};
let loggedMeals = [];

let activeDialogSourceId = null;
let activeTargetMeal = 'breakfast';
let currentView = 'chat';
let pending = false;
let generation = 0;
let activeChatController = null;
let initialDataLoaded = false;
const knowledgeCatalog = { state: 'idle', ids: [], error: '', promise: null };

// DOM ELEMENT REFERENCES
const views = {
  chat: document.querySelector('#chat-view'),
  stats: document.querySelector('#stats-view'),
  favorites: document.querySelector('#favorites-view'),
  settings: document.querySelector('#settings-view'),
  knowledge: document.querySelector('#knowledge-view')
};

const navButtons = {
  chat: document.querySelector('#assistant-nav'),
  stats: document.querySelector('#stats-nav'),
  favorites: document.querySelector('#favorites-nav'),
  settings: document.querySelector('#settings-nav'),
  knowledge: document.querySelector('#sources-nav')
};

const form = document.querySelector('#chat-form');
const input = document.querySelector('#question');
const send = document.querySelector('#send');
const conversation = document.querySelector('#conversation');
const welcome = document.querySelector('#welcome');
const composerArea = document.querySelector('#composer-area');
const viewTitle = document.querySelector('#view-title');
const dialog = document.querySelector('#source-dialog');
const addFoodDialog = document.querySelector('#add-food-dialog');

// UTILITY FUNCTIONS

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${name}`);
  svg.append(use);
  return svg;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function closeMenu() {
  document.body.classList.remove('menu-open');
  const menuBtn = document.querySelector('#menu-button');
  if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
}

// VIEW SWITCHER
function switchView(target) {
  if (!views[target]) return;
  currentView = target;

  Object.keys(views).forEach(key => {
    views[key].hidden = key !== target;
    if (navButtons[key]) {
      if (key === target) navButtons[key].classList.add('active');
      else navButtons[key].classList.remove('active');
    }
  });

  const titles = {
    chat: 'Чат с помощником',
    stats: 'Дневник и статистика',
    favorites: 'Избранные материалы',
    settings: 'Профиль и цели',
    knowledge: 'База знаний'
  };
  if (viewTitle) viewTitle.textContent = titles[target] || 'Помощник по питанию';

  if (composerArea) {
    composerArea.hidden = target !== 'chat';
  }

  closeMenu();

  if (target === 'stats') updateStatsUI();
  if (target === 'favorites') renderFavoritesUI('all');
  if (target === 'settings') fillSettingsForm();
  if (target === 'knowledge') loadKnowledgeCatalog();
}

// SOURCE DIALOG & FAVORITES
function showSourceModal(id, expandContent = false) {
  const source = sources[id];
  if (!source) return;
  activeDialogSourceId = id;

  document.querySelector('#source-title').textContent = source.title;
  document.querySelector('#source-description').textContent = source.description;
  const metadata = [source.id, source.publisher, source.updated_at && `Проверено: ${source.updated_at}`].filter(Boolean);
  document.querySelector('#source-metadata').textContent = metadata.join(' · ');
  const link = document.querySelector('#source-original');
  const url = safeSourceUrl(source.url);
  link.hidden = !url;
  if (url) link.href = url;
  else link.removeAttribute('href');
  const content = document.querySelector('#source-content');
  content.textContent = source.content || '';
  content.hidden = !source.content;
  document.querySelector('#source-full-text').open = expandContent;
  const excerpts = document.querySelector('#source-excerpts');
  excerpts.replaceChildren();
  const passages = sourcePassages.get(id) || [];
  if (passages.length) {
    excerpts.append(element('h3', '', 'Фрагменты, найденные в этой беседе'));
    passages.forEach(passage => excerpts.append(element('blockquote', '', passage.text)));
  }
  document.querySelector('#source-notice').textContent = url
    ? 'Текст в базе — краткий русскоязычный конспект по материалу указанного издателя. Оригинал доступен по ссылке.'
    : 'Это материал прежней демонстрационной версии. Проверяемая ссылка на публикацию не указана.';

  const favBtnText = document.querySelector('#fav-btn-text');
  if (favBtnText) favBtnText.textContent = source.bookmarked ? 'В избранном' : 'В избранное';

  closeMenu();
  dialog.showModal();
}

// KNOWLEDGE CATALOG — independent from the user's saved favorites.
function knowledgeSearchText(source) {
  return [source.id, source.title, source.description, source.publisher, source.content]
    .filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase('ru').replaceAll('ё', 'е');
}

function knowledgeMatches(source, query) {
  const terms = query.trim().normalize('NFKC').toLocaleLowerCase('ru').replaceAll('ё', 'е').split(/\s+/).filter(Boolean);
  const text = knowledgeSearchText(source);
  return terms.every(term => text.includes(term));
}

function renderKnowledgeCatalog() {
  const grid = document.querySelector('#knowledge-grid');
  const status = document.querySelector('#knowledge-status');
  const search = document.querySelector('#knowledge-search');
  grid.replaceChildren();
  grid.setAttribute('aria-busy', String(knowledgeCatalog.state === 'loading'));
  if (knowledgeCatalog.state === 'loading' || knowledgeCatalog.state === 'idle') {
    status.textContent = 'Загружаю материалы базы знаний…';
    return;
  }
  if (knowledgeCatalog.state === 'error') {
    status.textContent = 'Не удалось загрузить базу знаний.';
    const empty = element('div', 'empty-state');
    empty.setAttribute('role', 'alert');
    empty.append(element('h3', '', 'Материалы пока недоступны'), element('p', '', knowledgeCatalog.error));
    const retry = element('button', 'primary-btn', 'Повторить загрузку');
    retry.type = 'button';
    retry.addEventListener('click', () => loadKnowledgeCatalog(true));
    empty.append(retry); grid.append(empty);
    return;
  }
  const articles = knowledgeCatalog.ids.map(id => sources[id]).filter(Boolean);
  const items = articles.filter(source => knowledgeMatches(source, search.value));
  status.textContent = `Показано ${items.length} из ${articles.length} материалов`;
  if (!items.length) {
    const empty = element('div', 'empty-state');
    empty.append(element('h3', '', articles.length ? 'Ничего не найдено' : 'В базе пока нет материалов'),
      element('p', '', articles.length ? 'Попробуйте другое название, слово или ID документа, например D08.' : 'Добавьте документы в корпус и перезапустите сервер.'));
    grid.append(empty);
    return;
  }
  const categoryNames = { articles: 'Статья', tips: 'Совет', recipes: 'Рецепт' };
  items.forEach(source => {
    const card = element('article', 'favorite-card knowledge-card');
    card.append(element('span', 'favorite-badge', `${source.id} · ${categoryNames[source.category] || 'Материал'}`),
      element('h3', '', source.title), element('small', 'knowledge-publisher', source.publisher || ''),
      element('p', '', source.description));
    const actions = element('div', 'favorite-card-actions');
    const read = element('button', 'secondary-btn', 'Открыть материал');
    read.type = 'button';
    read.setAttribute('aria-label', `Открыть ${source.id}: ${source.title}`);
    read.addEventListener('click', () => showSourceModal(source.id, true));
    const save = element('button', 'knowledge-save-button' + (source.bookmarked ? ' active' : ''), source.bookmarked ? 'Сохранено' : 'В избранное');
    save.type = 'button';
    save.setAttribute('aria-pressed', String(!!source.bookmarked));
    save.setAttribute('aria-label', `В избранное: ${source.title}`);
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        await toggleSourceBookmark(source.id, save);
        save.textContent = sources[source.id].bookmarked ? 'Сохранено' : 'В избранное';
        save.setAttribute('aria-pressed', String(!!sources[source.id].bookmarked));
      } finally { save.disabled = false; }
    });
    actions.append(read, save); card.append(actions); grid.append(card);
  });
}

async function loadKnowledgeCatalog(force = false) {
  if (knowledgeCatalog.promise) return knowledgeCatalog.promise;
  if (knowledgeCatalog.state === 'ready' && !force) { renderKnowledgeCatalog(); return; }
  knowledgeCatalog.state = 'loading'; knowledgeCatalog.error = ''; renderKnowledgeCatalog();
  knowledgeCatalog.promise = (async () => {
    try {
      const articles = await apiGetKnowledge();
      articles.forEach(source => { sources[source.id] = source; });
      knowledgeCatalog.ids = articles.map(source => source.id);
      knowledgeCatalog.state = 'ready';
    } catch (error) {
      knowledgeCatalog.state = 'error';
      knowledgeCatalog.error = error instanceof TypeError ? 'Проверьте, что backend запущен, и повторите попытку.' : error.message;
    } finally {
      knowledgeCatalog.promise = null;
      renderKnowledgeCatalog();
    }
  })();
  return knowledgeCatalog.promise;
}

function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

async function loadChatStatus() {
  const node = document.querySelector('#chat-status');
  try {
    const status = await apiFetch('/api/chat/status');
    node.textContent = status.configured
      ? `Gemini настроен · поиск по ${status.documents} статьям`
      : `Поиск по ${status.documents} статьям · LLM не настроена, доступны выдержки`;
    node.dataset.state = status.configured ? 'connected' : 'retrieval';
    node.title = status.configured ? `Модель: ${status.model}. Доступ к API проверяется при отправке вопроса.`
      : 'Для генерации ответов добавьте GEMINI_API_KEY в серверный .env и перезапустите backend.';
  } catch {
    node.textContent = 'Не удалось проверить подключение к помощнику';
    node.dataset.state = 'error';
  }
}

async function toggleSourceBookmark(id, buttonEl) {
  if (!sources[id]) return;
  const newState = !sources[id].bookmarked;

  try {
    await apiToggleBookmark(id, newState);
    sources[id].bookmarked = newState;
  } catch (e) {
    console.error('Failed to toggle bookmark:', e);
    return;
  }

  if (buttonEl) {
    if (sources[id].bookmarked) buttonEl.classList.add('active');
    else buttonEl.classList.remove('active');
  }

  if (currentView === 'favorites') renderFavoritesUI();
  if (activeDialogSourceId === id) {
    const favBtnText = document.querySelector('#fav-btn-text');
    if (favBtnText) favBtnText.textContent = sources[id].bookmarked ? 'В избранном' : 'В избранное';
  }
}

// FOOD DIARY LOGIC & STATS
async function addFoodToMeal(mealType, foodObj) {
  try {
    const created = await apiCreateMeal({
      meal: mealType,
      name: foodObj.name,
      cals: Math.round(Number(foodObj.cals) || 0),
      protein: Math.round(Number(foodObj.protein) || 0),
      fat: Math.round(Number(foodObj.fat) || 0),
      carbs: Math.round(Number(foodObj.carbs) || 0),
      weight: Math.round(Number(foodObj.weight) || 150),
    });
    loggedMeals.push(created);
    updateStatsUI();
  } catch (e) {
    console.error('Failed to add meal:', e);
  }
}

async function removeMealEntry(entryId) {
  try {
    await apiDeleteMeal(entryId);
    loggedMeals = loggedMeals.filter(m => m.id !== entryId);
    updateStatsUI();
  } catch (e) {
    console.error('Failed to delete meal:', e);
  }
}

function updateStatsUI() {
  const targetCal = userProfile.calories || 2100;
  const targetProtein = userProfile.protein || 120;
  const targetFat = 70;
  const targetCarbs = 250;

  let consumedCal = 0;
  let consumedProtein = 0;
  let consumedFat = 0;
  let consumedCarbs = 0;

  const categoryTotals = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
  const categoryLists = { breakfast: [], lunch: [], dinner: [], snack: [] };

  loggedMeals.forEach(item => {
    consumedCal += item.cals;
    consumedProtein += item.protein;
    consumedFat += item.fat;
    consumedCarbs += item.carbs;

    if (categoryTotals[item.meal] !== undefined) {
      categoryTotals[item.meal] += item.cals;
      categoryLists[item.meal].push(item);
    }
  });

  const calValEl = document.querySelector('#cal-value');
  if (calValEl) {
    calValEl.replaceChildren();
    calValEl.append(document.createTextNode(`${consumedCal.toLocaleString('ru-RU')} `));
    const small = element('small', '', `/ ${targetCal.toLocaleString('ru-RU')} ккал`);
    calValEl.append(small);
  }

  const calProgressEl = document.querySelector('#cal-progress');
  if (calProgressEl) {
    const pct = Math.min(100, Math.round((consumedCal / targetCal) * 100));
    calProgressEl.style.width = pct + '%';
  }

  const calRemEl = document.querySelector('#cal-remaining-text');
  if (calRemEl) {
    const diff = targetCal - consumedCal;
    if (diff >= 0) {
      calRemEl.textContent = `Осталось ${diff.toLocaleString('ru-RU')} ккал до дневной нормы`;
    } else {
      calRemEl.textContent = `Превышение нормы на ${Math.abs(diff).toLocaleString('ru-RU')} ккал`;
    }
  }

  const protValEl = document.querySelector('#protein-value');
  if (protValEl) protValEl.textContent = `${consumedProtein} / ${targetProtein} г`;
  const protProgEl = document.querySelector('#protein-progress');
  if (protProgEl) protProgEl.style.width = Math.min(100, Math.round((consumedProtein / targetProtein) * 100)) + '%';

  const fatValEl = document.querySelector('#fat-value');
  if (fatValEl) fatValEl.textContent = `${consumedFat} / ${targetFat} г`;
  const fatProgEl = document.querySelector('#fat-progress');
  if (fatProgEl) fatProgEl.style.width = Math.min(100, Math.round((consumedFat / targetFat) * 100)) + '%';

  const carbsValEl = document.querySelector('#carbs-value');
  if (carbsValEl) carbsValEl.textContent = `${consumedCarbs} / ${targetCarbs} г`;
  const carbsProgEl = document.querySelector('#carbs-progress');
  if (carbsProgEl) carbsProgEl.style.width = Math.min(100, Math.round((consumedCarbs / targetCarbs) * 100)) + '%';

  ['breakfast', 'lunch', 'dinner', 'snack'].forEach(meal => {
    const calsEl = document.querySelector(`#${meal}-cals`);
    if (calsEl) calsEl.textContent = `${categoryTotals[meal]} ккал`;

    const listEl = document.querySelector(`#${meal}-items`);
    if (listEl) {
      listEl.replaceChildren();
      const items = categoryLists[meal];
      if (items.length === 0) {
        const emptyHint = element('div', '', 'Нет добавленных блюд');
        emptyHint.style.fontSize = '11px';
        emptyHint.style.color = '#94a090';
        emptyHint.style.padding = '4px 0';
        listEl.append(emptyHint);
      } else {
        items.forEach(item => {
          const row = element('div', 'meal-item');
          const info = element('div', 'meal-item-info');
          info.append(element('strong', '', item.name), element('small', '', `${item.weight} г · Б:${item.protein} Ж:${item.fat} У:${item.carbs}`));

          const right = element('div', 'meal-item-right');
          right.append(element('span', 'meal-item-cals', `${item.cals} ккал`));

          const removeBtn = element('button', 'remove-meal-item-btn');
          removeBtn.type = 'button';
          removeBtn.setAttribute('aria-label', 'Удалить блюдо');
          removeBtn.append(icon('trash'));
          removeBtn.addEventListener('click', () => removeMealEntry(item.id));

          right.append(removeBtn);
          row.append(info, right);
          listEl.append(row);
        });
      }
    }
  });

  const countEl = document.querySelector('#logged-meals-count');
  if (countEl) countEl.textContent = `${loggedMeals.length} блюд добавлено`;

  const chartTargetNum = document.querySelector('#chart-target-num');
  if (chartTargetNum) chartTargetNum.textContent = targetCal.toLocaleString('ru-RU');

  const weeklyChart = document.querySelector('#weekly-chart');
  if (weeklyChart) {
    weeklyChart.replaceChildren();
    const days = [
      { day: 'Пн', val: 1950 },
      { day: 'Вт', val: 2050 },
      { day: 'Ср', val: 1800 },
      { day: 'Чт', val: 2150 },
      { day: 'Пт', val: consumedCal || 1650, current: true },
      { day: 'Сб', val: 2200 },
      { day: 'Вс', val: 1900 }
    ];

    days.forEach(item => {
      const col = element('div', 'chart-col' + (item.current ? ' current' : ''));
      const wrap = element('div', 'chart-bar-wrap');
      const inner = element('div', 'chart-bar-inner');
      const hPct = Math.min(100, Math.round((item.val / targetCal) * 100));
      inner.style.height = hPct + '%';
      wrap.append(inner);

      const dayLbl = element('div', 'chart-day', item.day);
      col.append(wrap, dayLbl);
      weeklyChart.append(col);
    });
  }
}

// FOOD PICKER DIALOG HANDLING
function openFoodDialog(mealType) {
  activeTargetMeal = mealType;
  const titles = { breakfast: '🌅 Завтрак', lunch: '☀️ Обед', dinner: '🌙 Ужин', snack: '🍏 Перекусы' };
  const titleEl = document.querySelector('#food-dialog-meal-title');
  if (titleEl) titleEl.textContent = `Добавить в ${titles[mealType] || 'приём пищи'}`;

  renderFoodPresetList('');
  const searchInp = document.querySelector('#food-search-input');
  if (searchInp) searchInp.value = '';

  switchFoodTab('preset');
  addFoodDialog.showModal();
}

function renderFoodPresetList(filterText) {
  const listEl = document.querySelector('#food-preset-list');
  if (!listEl) return;
  listEl.replaceChildren();

  const q = filterText.toLowerCase().trim();
  const items = FOOD_DATASET.filter(f => !q || f.name.toLowerCase().includes(q));

  if (items.length === 0) {
    const noResults = element('div', '', 'Ничего не найдено в базе');
    noResults.style.fontSize = '12px';
    noResults.style.color = '#889484';
    noResults.style.padding = '12px';
    noResults.style.textAlign = 'center';
    listEl.append(noResults);
    return;
  }

  items.forEach(food => {
    const row = element('div', 'food-preset-item');
    const info = element('div', 'food-preset-info');
    info.append(
      element('strong', '', food.name),
      element('small', '', `${food.cals} ккал · ${food.weight}г · Б:${food.protein}г Ж:${food.fat}г У:${food.carbs}г`)
    );

    const addBtn = element('button', 'food-preset-add-btn', '+ Добавить');
    addBtn.type = 'button';
    addBtn.addEventListener('click', () => {
      addFoodToMeal(activeTargetMeal, food);
      addFoodDialog.close();
    });

    row.append(info, addBtn);
    listEl.append(row);
  });
}

function switchFoodTab(tabName) {
  const presetPanel = document.querySelector('#food-preset-panel');
  const customForm = document.querySelector('#custom-food-form');
  const presetBtn = document.querySelector('#tab-preset-btn');
  const customBtn = document.querySelector('#tab-custom-btn');

  if (tabName === 'preset') {
    presetPanel.hidden = false;
    customForm.hidden = true;
    presetBtn.classList.add('active');
    customBtn.classList.remove('active');
  } else {
    presetPanel.hidden = true;
    customForm.hidden = false;
    customBtn.classList.add('active');
    presetBtn.classList.remove('active');
  }
}

// CHAT RENDER & LOGIC
function syncInput() {
  send.disabled = pending || !input.value.trim();
  const diaryButton = document.querySelector('#ask-about-stats-btn');
  diaryButton.disabled = pending;
  diaryButton.textContent = pending ? 'Дождитесь ответа в чате…' : 'Спросить ассистента о рационе';
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
}

function assistantHeading() {
  const heading = element('div', 'assistant-heading');
  const avatar = element('span', 'avatar');
  avatar.append(icon('leaf'));
  heading.append(avatar, element('span', '', 'Помощник по питанию'), element('span', 'mock-tag', 'ОТВЕТ АССИСТЕНТА'));
  return heading;
}

function assistantMessage() {
  const message = element('article', 'message assistant-message');
  message.append(assistantHeading());
  return message;
}

function scrollToMessage(msg) {
  msg.scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    block: 'start'
  });
}

function addAnswer(answer) {
  const message = assistantMessage();
  const modeLabel = message.querySelector('.mock-tag');
  modeLabel.textContent = answer.mode === 'gemini' ? 'GEMINI + ИСТОЧНИКИ'
    : answer.mode === 'retrieval' ? 'НАЙДЕННЫЕ ФРАГМЕНТЫ' : 'НЕДОСТАТОЧНО МАТЕРИАЛОВ';
  const body = element('div', 'answer-body');
  if (answer.diary_summary) {
    const summary = answer.diary_summary;
    const snapshot = element('section', 'diary-reply-summary');
    snapshot.setAttribute('aria-label', 'Сводка записанного рациона');
    const number = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : '—';
    snapshot.append(element('strong', '', `По записям дневника: ${number(summary.record_count)} блюд`),
      element('p', '', `Калории: ${number(summary.totals?.calories)} / ${number(summary.targets?.calories)} ккал · Белки: ${number(summary.totals?.protein)} / ${number(summary.targets?.protein)} г`),
      element('p', '', `Жиры: ${number(summary.totals?.fat)} г · Углеводы: ${number(summary.totals?.carbs)} г`));
    if (summary.scope_note) snapshot.append(element('small', '', summary.scope_note));
    body.append(snapshot);
  }
  body.append(element('p', '', answer.intro));

  const list = element('ul');
  answer.items.forEach(item => list.append(element('li', '', item)));
  if (answer.items.length) body.append(list);
  body.append(element('p', '', answer.end));
  if (answer.warning) body.append(element('p', 'chat-warning', answer.warning));

  const heading = element('div', 'source-heading');
  heading.append(icon('book'), element('span', '', 'Источники ответа · ' + answer.sources.length));

  const cards = element('div', 'source-cards');
  answer.sources.forEach((id, index) => {
    const source = sources[id];
    if (!source) return;

    const card = element('div', 'source-card');
    const num = element('span', 'source-number', `0${index + 1}`);

    const content = element('button', 'source-card-content');
    content.type = 'button';
    content.append(element('strong', '', source.title), element('small', '', source.publisher || 'Открыть материал и фрагменты'));
    content.addEventListener('click', () => showSourceModal(id));

    const favBtn = element('button', 'source-fav-btn' + (source.bookmarked ? ' active' : ''));
    favBtn.type = 'button';
    favBtn.setAttribute('aria-label', 'Сохранить в избранное');
    favBtn.append(icon('heart'));
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSourceBookmark(id, favBtn);
    });

    card.append(num, content, favBtn);
    cards.append(card);
  });

  if (answer.sources.length) body.append(heading, cards);
  const passages = answer.passages || [];
  if (passages.length) {
    const details = element('details', 'retrieval-details');
    details.append(element('summary', '', 'Посмотреть найденные фрагменты'));
    passages.forEach(passage => {
      const section = element('div', 'retrieval-passage');
      section.append(element('strong', '', passage.title), element('blockquote', '', passage.text));
      details.append(section);
    });
    body.append(details);
  }
  body.append(element('p', 'answer-note', answer.mode === 'gemini'
    ? `Ответ сформирован ${answer.model || 'Gemini'} по указанным фрагментам. Ответ может содержать ошибки — проверяйте источники.`
    : answer.mode === 'retrieval'
      ? 'Показаны выдержки из локальной базы. Генерация ответа нейросетью не выполнялась.'
      : 'В локальной базе не найдено достаточно материалов для ответа.'));
  message.append(body);
  conversation.append(message);
  scrollToMessage(message);
}

async function ask(question, options = {}) {
  if (pending) { switchView('chat'); return; }
  if (!question.trim()) return;
  const requestScope = options.scope === 'diary' ? 'diary' : 'general';
  if (question.trim().length > 2000) {
    input.setCustomValidity('Сократите вопрос до 2000 символов.');
    input.reportValidity();
    return;
  }

  switchView('chat');
  pending = true;
  const request = ++generation;
  const controller = new AbortController();
  activeChatController = controller;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 45000);

  closeMenu();
  welcome.hidden = true;
  conversation.hidden = false;

  const user = element('article', 'message user-message');
  user.append(element('div', 'user-bubble', question.trim()));
  conversation.append(user);

  const loading = assistantMessage();
  const status = element('div', 'typing');
  status.setAttribute('role', 'status');
  const dots = element('span', 'typing-dots');
  dots.setAttribute('aria-hidden', 'true');
  dots.append(element('i'), element('i'), element('i'));
  status.append(dots, element('span', '', 'Ищу материалы и готовлю ответ…'));
  loading.append(status);
  conversation.append(loading);

  input.value = '';
  input.disabled = true;
  conversation.setAttribute('aria-busy', 'true');
  syncInput();
  document.querySelectorAll('.suggestion').forEach(btn => btn.disabled = true);
  scrollToMessage(user);

  try {
    const answer = await apiChat(question.trim(), controller.signal, { scope: requestScope });
    if (request !== generation) return;
    // Sources normally arrive at startup. Refresh if the corpus changed meanwhile.
    if (answer.sources.some(id => !sources[id])) {
      const refreshed = await apiGetSources(controller.signal);
      if (request !== generation) return;
      refreshed.forEach(source => { sources[source.id] = source; });
    }
    (answer.passages || []).forEach(passage => {
      const group = sourcePassages.get(passage.source_id) || [];
      if (!group.some(existing => existing.chunk_id === passage.chunk_id)) group.push(passage);
      sourcePassages.set(passage.source_id, group);
    });
    loading.remove();
    addAnswer(answer);
  } catch (e) {
    if (request !== generation) return;
    loading.remove();
    const errMsg = assistantMessage();
    const body = element('div', 'answer-body chat-error');
    body.setAttribute('role', 'alert');
    const text = timedOut ? 'Ответ не получен за 45 секунд. Попробуйте повторить запрос.'
      : e instanceof TypeError ? 'Не удалось связаться с сервером. Проверьте подключение и запуск backend.'
      : e.message || 'Не удалось получить ответ. Попробуйте ещё раз.';
    body.append(element('p', '', text));
    const retry = element('button', 'secondary-btn', 'Повторить вопрос');
    retry.type = 'button';
    retry.addEventListener('click', () => { if (!pending) { retry.disabled = true; ask(question, { scope: requestScope }); } });
    body.append(retry);
    errMsg.append(body);
    conversation.append(errMsg);
    scrollToMessage(errMsg);
  } finally {
    clearTimeout(timeout);
    // A cancelled request must never unlock a newer request after reset.
    if (request === generation) {
      activeChatController = null;
      pending = false;
      input.disabled = false;
      conversation.setAttribute('aria-busy', 'false');
      syncInput();
      document.querySelectorAll('.suggestion').forEach(btn => btn.disabled = false);
      if (currentView === 'chat') input.focus({ preventScroll: true });
    }
  }
}

function resetChat() {
  generation++;
  activeChatController?.abort();
  activeChatController = null;
  pending = false;
  sourcePassages.clear();
  conversation.replaceChildren();
  conversation.hidden = true;
  conversation.removeAttribute('aria-busy');
  welcome.hidden = false;
  input.disabled = false;
  input.value = '';
  document.querySelectorAll('.suggestion').forEach(btn => btn.disabled = false);
  syncInput();
  switchView('chat');
  window.scrollTo(0, 0);
  input.focus({ preventScroll: true });
}

// FAVORITES RENDER
function renderFavoritesUI(filterCat = 'all') {
  const grid = document.querySelector('#favorites-grid');
  if (!grid) return;
  grid.replaceChildren();

  const allItems = Object.values(sources).filter(s => s.bookmarked);
  const items = filterCat === 'all' ? allItems : allItems.filter(s => s.category === filterCat);

  const filterPills = document.querySelectorAll('.filter-pill');
  filterPills.forEach(pill => {
    const cat = pill.dataset.cat;
    if (cat === 'all') pill.textContent = `Все (${allItems.length})`;
    if (cat === filterCat) pill.classList.add('active');
    else pill.classList.remove('active');
  });

  if (items.length === 0) {
    const empty = element('div', 'empty-state');
    const emptyIcon = element('div', 'empty-icon');
    emptyIcon.append(icon('heart'));
    empty.append(
      emptyIcon,
      element('h3', '', 'Список избранного пуст'),
      element('p', '', 'Сохраняйте полезные материалы и карточки источников из чата, нажимая на иконку сердечка.')
    );
    const goChatBtn = element('button', 'primary-btn', 'Перейти к чату');
    goChatBtn.addEventListener('click', () => switchView('chat'));
    empty.append(goChatBtn);
    grid.append(empty);
    return;
  }

  const categoryNames = { articles: 'Статья', tips: 'Совет', recipes: 'Рецепт' };

  items.forEach(item => {
    const card = element('div', 'favorite-card');
    card.append(
      element('span', 'favorite-badge', categoryNames[item.category] || 'Материал'),
      element('h4', '', item.title),
      element('p', '', item.description)
    );

    const actions = element('div', 'favorite-card-actions');
    const readBtn = element('button', 'secondary-btn', 'Читать детально');
    readBtn.addEventListener('click', () => showSourceModal(item.id));

    const removeBtn = element('button', 'remove-fav-btn');
    removeBtn.append(icon('close'), document.createTextNode('Удалить'));
    removeBtn.addEventListener('click', () => toggleSourceBookmark(item.id));

    actions.append(readBtn, removeBtn);
    card.append(actions);
    grid.append(card);
  });
}

// SETTINGS FORM HANDLING
function fillSettingsForm() {
  document.querySelector('#user-name').value = userProfile.name || '';
  document.querySelector('#user-age').value = userProfile.age || 28;
  document.querySelector('#user-height').value = userProfile.height || 178;
  document.querySelector('#user-weight').value = userProfile.weight || 74;
  document.querySelector('#user-goal').value = userProfile.goal || 'maintenance';
  document.querySelector('#user-calories').value = userProfile.calories || 2100;
  document.querySelector('#user-protein').value = userProfile.protein || 120;
  document.querySelector('#pref-lactose').checked = !!userProfile.lactose;
  document.querySelector('#pref-gluten').checked = !!userProfile.gluten;
  document.querySelector('#pref-veg').checked = !!userProfile.veg;
  document.querySelector('#pref-sugar').checked = !!userProfile.sugar;
}

const settingsForm = document.querySelector('#settings-form');
if (settingsForm) {
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const updated = {
      name: document.querySelector('#user-name').value.trim() || 'Пользователь',
      age: Number(document.querySelector('#user-age').value) || 28,
      height: Number(document.querySelector('#user-height').value) || 178,
      weight: Number(document.querySelector('#user-weight').value) || 74,
      goal: document.querySelector('#user-goal').value,
      calories: Number(document.querySelector('#user-calories').value) || 2100,
      protein: Number(document.querySelector('#user-protein').value) || 120,
      lactose: document.querySelector('#pref-lactose').checked,
      gluten: document.querySelector('#pref-gluten').checked,
      veg: document.querySelector('#pref-veg').checked,
      sugar: document.querySelector('#pref-sugar').checked
    };

    try {
      userProfile = await apiUpdateProfile(updated);
      updateStatsUI();

      const toast = document.querySelector('#settings-toast');
      if (toast) {
        toast.hidden = false;
        setTimeout(() => { toast.hidden = true; }, 2500);
      }
    } catch (e) {
      console.error('Failed to save profile:', e);
      alert('Ошибка сохранения профиля');
    }
  });
}

// EVENT LISTENERS & INITIALIZATION
input.addEventListener('input', () => { input.setCustomValidity(''); syncInput(); });
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    ask(input.value);
  }
});
form.addEventListener('submit', event => {
  event.preventDefault();
  ask(input.value);
});

document.querySelectorAll('.suggestion').forEach(button => {
  button.addEventListener('click', () => ask(button.dataset.question));
});

// Sidebar & Navigation buttons
document.querySelector('#new-chat').addEventListener('click', resetChat);
navButtons.chat.addEventListener('click', () => switchView('chat'));
navButtons.stats.addEventListener('click', () => switchView('stats'));
navButtons.favorites.addEventListener('click', () => switchView('favorites'));
navButtons.settings.addEventListener('click', () => switchView('settings'));

navButtons.knowledge.addEventListener('click', () => switchView('knowledge'));
document.querySelector('#top-sources').addEventListener('click', () => switchView('knowledge'));
document.querySelector('#knowledge-search').addEventListener('input', renderKnowledgeCatalog);

// Dialog controls
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
document.querySelector('#dialog-done').addEventListener('click', () => dialog.close());

document.querySelector('#close-food-dialog').addEventListener('click', () => addFoodDialog.close());

const toggleDialogFavBtn = document.querySelector('#toggle-dialog-favorite');
if (toggleDialogFavBtn) {
  toggleDialogFavBtn.addEventListener('click', () => {
    if (activeDialogSourceId) toggleSourceBookmark(activeDialogSourceId);
  });
}

dialog.addEventListener('click', event => {
  if (event.target === dialog) {
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      dialog.close();
    }
  }
});

addFoodDialog.addEventListener('click', event => {
  if (event.target === addFoodDialog) {
    const bounds = addFoodDialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      addFoodDialog.close();
    }
  }
});

// "Добавить блюдо" buttons under categories
document.querySelectorAll('.add-food-btn').forEach(btn => {
  btn.addEventListener('click', () => openFoodDialog(btn.dataset.meal));
});

// Food Dialog Search & Tabs
const foodSearchInput = document.querySelector('#food-search-input');
if (foodSearchInput) {
  foodSearchInput.addEventListener('input', (e) => renderFoodPresetList(e.target.value));
}

document.querySelector('#tab-preset-btn').addEventListener('click', () => switchFoodTab('preset'));
document.querySelector('#tab-custom-btn').addEventListener('click', () => switchFoodTab('custom'));

// Custom food form submission
const customFoodForm = document.querySelector('#custom-food-form');
if (customFoodForm) {
  customFoodForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const customFood = {
      name: document.querySelector('#custom-food-name').value.trim(),
      cals: Number(document.querySelector('#custom-food-cals').value) || 0,
      protein: Number(document.querySelector('#custom-food-prot').value) || 0,
      fat: Number(document.querySelector('#custom-food-fat').value) || 0,
      carbs: Number(document.querySelector('#custom-food-carbs').value) || 0,
      weight: Number(document.querySelector('#custom-food-weight').value) || 150
    };
    addFoodToMeal(activeTargetMeal, customFood);
    addFoodDialog.close();
    customFoodForm.reset();
  });
}

// Mobile Drawer
document.querySelector('#menu-button').addEventListener('click', () => {
  const open = document.body.classList.toggle('menu-open');
  document.querySelector('#menu-button').setAttribute('aria-expanded', String(open));
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeMenu();
    if (addFoodDialog.open) addFoodDialog.close();
    if (dialog.open) dialog.close();
  }
});

document.addEventListener('click', event => {
  if (document.body.classList.contains('menu-open') && !event.target.closest('#sidebar, #menu-button')) {
    closeMenu();
  }
});

// Extra buttons inside stats/settings views
const askAboutStatsBtn = document.querySelector('#ask-about-stats-btn');
if (askAboutStatsBtn) {
  askAboutStatsBtn.addEventListener('click', () => {
    if (pending) { switchView('chat'); return; }
    const notice = document.querySelector('#diary-analysis-status');
    if (initialDataLoaded && !loggedMeals.length) {
      notice.hidden = false;
      notice.textContent = 'Сначала добавьте хотя бы одно блюдо в дневник. Тогда ассистент сможет сравнить записанные калории и БЖУ с заданными целями.';
      return;
    }
    notice.hidden = true;
    ask('Проанализируй мой записанный рацион: сравни калории и БЖУ с заданными целями и подскажи, на что обратить внимание.', { scope: 'diary' });
  });
}

const resetChatDataBtn = document.querySelector('#reset-chat-data-btn');
if (resetChatDataBtn) {
  resetChatDataBtn.addEventListener('click', () => {
    resetChat();
    alert('История диалогов успешно очищена.');
  });
}

const resetMealsDataBtn = document.querySelector('#reset-meals-data-btn');
if (resetMealsDataBtn) {
  resetMealsDataBtn.addEventListener('click', async () => {
    try {
      await apiDeleteAllMeals();
      loggedMeals = [];
      updateStatsUI();
      alert('Дневник питания сброшен.');
    } catch (e) {
      console.error('Failed to reset meals:', e);
      alert('Ошибка при сбросе дневника.');
    }
  });
}

// Favorites filter pills
const favFiltersContainer = document.querySelector('#favorites-filters');
if (favFiltersContainer) {
  favFiltersContainer.addEventListener('click', (e) => {
    const pill = e.target.closest('.filter-pill');
    if (pill) renderFavoritesUI(pill.dataset.cat);
  });
}

// ── INITIAL APP LOAD (async from API) ──
async function initApp() {
  loadChatStatus();
  try {
    // Load all data from backend in parallel
    const [profileData, mealsData, sourcesData, foodsData] = await Promise.all([
      apiGetProfile(),
      apiGetMeals(),
      apiGetSources(),
      apiGetFoods(),
    ]);

    userProfile = profileData;
    loggedMeals = mealsData;

    // Convert sources array to object keyed by id
    sourcesData.forEach(s => { if (!sources[s.id]) sources[s.id] = s; });

    FOOD_DATASET = foodsData;
    initialDataLoaded = true;
  } catch (e) {
    console.error('Failed to load data from API, app may not work correctly:', e);
  }

  switchView(currentView);
  syncInput();
}

initApp();

