// ── API Client ──
const API_BASE = '';  // Same origin; change to 'http://localhost:8000' if running separately

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
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

async function apiGetSources() {
  return apiFetch('/api/sources');
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

async function apiChat(question) {
  return apiFetch('/api/chat', { method: 'POST', body: JSON.stringify({ question }) });
}

// KNOWLEDGE BASE & MOCK DATA (kept for initial fallback; sources now come from API)

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
let responseTimer;

// DOM ELEMENT REFERENCES
const views = {
  chat: document.querySelector('#chat-view'),
  stats: document.querySelector('#stats-view'),
  favorites: document.querySelector('#favorites-view'),
  settings: document.querySelector('#settings-view')
};

const navButtons = {
  chat: document.querySelector('#assistant-nav'),
  stats: document.querySelector('#stats-nav'),
  favorites: document.querySelector('#favorites-nav'),
  settings: document.querySelector('#settings-nav')
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
    settings: 'Профиль и цели'
  };
  if (viewTitle) viewTitle.textContent = titles[target] || 'Помощник по питанию';

  if (composerArea) {
    composerArea.hidden = target !== 'chat';
  }

  closeMenu();

  if (target === 'stats') updateStatsUI();
  if (target === 'favorites') renderFavoritesUI('all');
  if (target === 'settings') fillSettingsForm();
}

// SOURCE DIALOG & FAVORITES
function showSourceModal(id) {
  const source = sources[id];
  if (!source) return;
  activeDialogSourceId = id;

  document.querySelector('#source-title').textContent = source.title;
  document.querySelector('#source-description').textContent = source.description;

  const favBtnText = document.querySelector('#fav-btn-text');
  if (favBtnText) favBtnText.textContent = source.bookmarked ? 'В избранном' : 'В избранное';

  closeMenu();
  dialog.showModal();
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

function addAnswer(mock) {
  const message = assistantMessage();
  const body = element('div', 'answer-body');
  body.append(element('p', '', mock.intro));

  const list = element('ul');
  mock.items.forEach(item => list.append(element('li', '', item)));
  body.append(list, element('p', '', mock.end));

  const heading = element('div', 'source-heading');
  heading.append(icon('book'), element('span', '', 'Источники ответа · ' + mock.sources.length));

  const cards = element('div', 'source-cards');
  mock.sources.forEach((id, index) => {
    const source = sources[id];
    if (!source) return;

    const card = element('div', 'source-card');
    const num = element('span', 'source-number', `0${index + 1}`);

    const content = element('div', 'source-card-content');
    content.append(element('strong', '', source.title), element('small', '', 'Нажмите для просмотра деталей'));
    content.addEventListener('click', () => showSourceModal(id));
    content.style.cursor = 'pointer';

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

  body.append(heading, cards, element('p', 'answer-note', 'Ответ сформирован по базе знаний ассистента.'));
  message.append(body);
  conversation.append(message);
  scrollToMessage(message);
}

async function ask(question) {
  if (pending || !question.trim()) return;

  switchView('chat');
  pending = true;
  const request = ++generation;

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
  status.append(dots, element('span', '', 'Готовлю развернутый ответ…'));
  loading.append(status);
  conversation.append(loading);

  input.value = '';
  input.disabled = true;
  conversation.setAttribute('aria-busy', 'true');
  syncInput();
  document.querySelectorAll('.suggestion').forEach(btn => btn.disabled = true);
  scrollToMessage(user);

  try {
    const mock = await apiChat(question);
    if (request !== generation) return;
    loading.remove();
    addAnswer(mock);
  } catch (e) {
    console.error('Chat error:', e);
    if (request !== generation) return;
    loading.remove();
    const errMsg = assistantMessage();
    errMsg.append(element('p', 'answer-body', 'Не удалось получить ответ. Попробуйте ещё раз.'));
    conversation.append(errMsg);
  } finally {
    pending = false;
    input.disabled = false;
    conversation.setAttribute('aria-busy', 'false');
    syncInput();
    document.querySelectorAll('.suggestion').forEach(btn => btn.disabled = false);
    input.focus({ preventScroll: true });
  }
}

function resetChat() {
  generation++;
  clearTimeout(responseTimer);
  pending = false;
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
input.addEventListener('input', syncInput);
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

document.querySelector('#sources-nav').addEventListener('click', () => switchView('favorites'));
document.querySelector('#top-sources').addEventListener('click', () => switchView('favorites'));

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
    ask('Как распределить мой дневной калораж для более эффективного достижения цели?');
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
    sources = {};
    sourcesData.forEach(s => { sources[s.id] = s; });

    FOOD_DATASET = foodsData;
  } catch (e) {
    console.error('Failed to load data from API, app may not work correctly:', e);
  }

  switchView('chat');
  syncInput();
}

initApp();

