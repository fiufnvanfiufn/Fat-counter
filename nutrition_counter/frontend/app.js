// KNOWLEDGE BASE & MOCK DATA
const INITIAL_SOURCES = {
  protein: { id: 'protein', title: 'Источники белка в повседневном рационе', category: 'articles', description: 'Статья о разнообразии белковых продуктов: птице, рыбе, яйцах, бобовых и тофу. Разбор пищевой ценности и усвояемости.', bookmarked: false },
  alternatives: { id: 'alternatives', title: 'Как выбирать альтернативы мясу', category: 'tips', description: 'Практический обзор замен привычных видов мяса с учётом вкуса, способа приготовления и баланса нутриентов.', bookmarked: false },
  plate: { id: 'plate', title: 'Принцип сбалансированной тарелки', category: 'articles', description: 'Наглядный метод формирования приёма пищи: 50% овощей и зелени, 25% белка, 25% сложных углеводов.', bookmarked: true },
  habits: { id: 'habits', title: 'Простые привычки в питании', category: 'tips', description: 'Советы по планированию заготовок, регулярному гидратированию и осознанному выбору продуктов на каждый день.', bookmarked: false },
  snacks: { id: 'snacks', title: 'Идеи для полезного перекуса', category: 'recipes', description: 'Быстрые и питательные сочетания с белком и клетчаткой для поддержания энергии между основными приёмами пищи.', bookmarked: false }
};

// FOOD DATASET (Pre-populated database of foods and dishes)
const FOOD_DATASET = [
  { id: 'f1', name: 'Овсяная каша с ягодами', cals: 210, protein: 6, fat: 4, carbs: 36, weight: 200 },
  { id: 'f2', name: 'Омлет со шпинатом (2 яйца)', cals: 240, protein: 16, fat: 18, carbs: 2, weight: 150 },
  { id: 'f3', name: 'Куриное филе на гриле', cals: 165, protein: 31, fat: 3.5, carbs: 0, weight: 150 },
  { id: 'f4', name: 'Гречка отварная с оливковым маслом', cals: 180, protein: 6, fat: 5, carbs: 28, weight: 180 },
  { id: 'f5', name: 'Лосось на пару с овощами', cals: 290, protein: 24, fat: 18, carbs: 6, weight: 220 },
  { id: 'f6', name: 'Творог 5% с миндалём и мёдом', cals: 230, protein: 18, fat: 11, carbs: 14, weight: 160 },
  { id: 'f7', name: 'Салат из свежих овощей', cals: 90, protein: 2, fat: 5, carbs: 8, weight: 150 },
  { id: 'f8', name: 'Яблоко зелёное', cals: 80, protein: 0.4, fat: 0.2, carbs: 19, weight: 150 },
  { id: 'f9', name: 'Греческий йогурт натуральный', cals: 130, protein: 10, fat: 5, carbs: 6, weight: 140 },
  { id: 'f10', name: 'Тост с авокадо и яйцом пашот', cals: 280, protein: 11, fat: 16, carbs: 22, weight: 140 }
];

// DEFAULT SAMPLE MEALS IF NONE LOGGED
const INITIAL_LOGGED_MEALS = [
  { id: 'm1', meal: 'breakfast', name: 'Омлет со шпинатом (2 яйца)', cals: 240, protein: 16, fat: 18, carbs: 2, weight: 150 },
  { id: 'm2', meal: 'breakfast', name: 'Овсяная каша с ягодами', cals: 210, protein: 6, fat: 4, carbs: 36, weight: 200 },
  { id: 'm3', meal: 'lunch', name: 'Куриное филе на гриле', cals: 165, protein: 31, fat: 3.5, carbs: 0, weight: 150 },
  { id: 'm4', meal: 'lunch', name: 'Гречка отварная с оливковым маслом', cals: 180, protein: 6, fat: 5, carbs: 28, weight: 180 }
];

const MOCK_RESPONSES = {
  alternatives: {
    intro: 'В качестве замены свинине можно рассмотреть несколько отличных продуктов — выбор зависит от конкретного блюда и ваших целей:',
    items: [
      'Птица (курица, индейка) — диетический источник белка с низким содержанием насыщенных жиров.',
      'Рыба и морепродукты — обогащают рацион Омега-3 жирными кислотами.',
      'Чечевица, фасоль и нут — растительные альтернативы с высоким содержанием клетчатки.'
    ],
    end: 'Попробуйте начать с замены в одном любимом блюде (например, приготовьте рагу с индейкой или нутом).',
    sources: ['alternatives', 'protein']
  },
  protein: {
    intro: 'Белок необходимо получать из разнообразных источников для полноценного набора аминокислот:',
    items: [
      'Животные источники: филе индейки/курицы, нежирная рыба, творог 2-5%, яйца.',
      'Растительные источники: чечевица, маш, нут, тофу и цельнозерновые крупы.',
      'Орехи и семена — как дополнение к основным блюдам.'
    ],
    end: 'Оптимально распределять белок равномерно между 3–4 приёмами пищи в течение дня.',
    sources: ['protein', 'plate']
  },
  plate: {
    intro: 'Для сборки сбалансированного приёма пищи используйте проверенное правило гарвардской тарелки:',
    items: [
      '1/2 тарелки: свежие или тушёные овощи, зелень, салатные листья.',
      '1/4 тарелки: нежирный белок (рыба, птица, бобовые, яйца).',
      '1/4 тарелки: сложные углеводы (гречка, бурый рис, киноа, цельнозерновые макароны).'
    ],
    end: 'Добавьте 1 чайную ложку полезного растительного масла (оливковое, льняное) для заправки.',
    sources: ['plate', 'habits']
  },
  snacks: {
    intro: 'Полезный перекус должен сочетать сложные углеводы или клетчатку с белком:',
    items: [
      'Натуральный греческий йогурт + горсть свежих ягод.',
      'Яблоко или дольки груши + 15–20 г сырого миндаля.',
      'Цельнозерновой тост + паста из авокадо или хумус.'
    ],
    end: 'Такие сочетания обеспечивают долгую сытость без резких скачков сахара в крови.',
    sources: ['snacks', 'habits']
  },
  general: {
    intro: 'Спасибо за вопрос! Чтобы составить правильный рацион, придерживайтесь базовых ориентиров:',
    items: [
      'Разнообразие: включайте продукты разных цветов и групп каждый день.',
      'Регулярность: питайтесь каждые 3.5–4.5 часа без длительного голодания.',
      'Гидратация: поддерживайте питьевой режим в течение дня.'
    ],
    end: 'Задайте более конкретный вопрос — например: «Какие продукты богаты белком?» или «Как собрать сбалансированный обед?».',
    sources: ['plate', 'habits']
  }
};

// LOCAL STORAGE KEYS & APP STATE
const STORAGE_KEY_PROFILE = 'fat_counter_profile_v1';
const STORAGE_KEY_SOURCES = 'fat_counter_sources_v1';
const STORAGE_KEY_MEALS = 'fat_counter_meals_v1';

let sources = loadSources();
let userProfile = loadProfile();
let loggedMeals = loadMeals();

let activeDialogSourceId = null;
let activeTargetMeal = 'breakfast'; // 'breakfast' | 'lunch' | 'dinner' | 'snack'
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
function loadProfile() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_PROFILE);
    if (saved) return JSON.parse(saved);
  } catch (e) { /* fallback */ }
  return {
    name: 'Алексей', age: 28, height: 178, weight: 74,
    goal: 'maintenance', calories: 2100, protein: 120,
    lactose: true, gluten: false, veg: false, sugar: false
  };
}

function saveProfile(p) {
  userProfile = p;
  try { localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(p)); } catch (e) {}
  updateStatsUI();
}

function loadSources() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_SOURCES);
    if (saved) return JSON.parse(saved);
  } catch (e) { /* fallback */ }
  return JSON.parse(JSON.stringify(INITIAL_SOURCES));
}

function saveSources() {
  try { localStorage.setItem(STORAGE_KEY_SOURCES, JSON.stringify(sources)); } catch (e) {}
}

function loadMeals() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_MEALS);
    if (saved) return JSON.parse(saved);
  } catch (e) { /* fallback */ }
  return JSON.parse(JSON.stringify(INITIAL_LOGGED_MEALS));
}

function saveMeals() {
  try { localStorage.setItem(STORAGE_KEY_MEALS, JSON.stringify(loggedMeals)); } catch (e) {}
  updateStatsUI();
}

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

function toggleSourceBookmark(id, buttonEl) {
  if (!sources[id]) return;
  sources[id].bookmarked = !sources[id].bookmarked;
  saveSources();

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
function addFoodToMeal(mealType, foodObj) {
  const newEntry = {
    id: 'm_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
    meal: mealType,
    name: foodObj.name,
    cals: Math.round(Number(foodObj.cals) || 0),
    protein: Math.round(Number(foodObj.protein) || 0),
    fat: Math.round(Number(foodObj.fat) || 0),
    carbs: Math.round(Number(foodObj.carbs) || 0),
    weight: Math.round(Number(foodObj.weight) || 150)
  };
  loggedMeals.push(newEntry);
  saveMeals();
}

function removeMealEntry(entryId) {
  loggedMeals = loggedMeals.filter(m => m.id !== entryId);
  saveMeals();
}

function updateStatsUI() {
  const targetCal = userProfile.calories || 2100;
  const targetProtein = userProfile.protein || 120;
  const targetFat = 70;
  const targetCarbs = 250;

  // Compute total calories and macros from logged meals for today
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

  // Update total calories card
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

  // Update macros
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

  // Update category lists in HTML
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

  // Render weekly chart
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

  // Reset to preset tab
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

function selectMock(question) {
  const q = question.toLocaleLowerCase('ru');
  if (/свинин|замен|альтернатив/.test(q)) return MOCK_RESPONSES.alternatives;
  if (/бел[ко]|протеин/.test(q)) return MOCK_RESPONSES.protein;
  if (/обед|сбаланс|тарелк/.test(q)) return MOCK_RESPONSES.plate;
  if (/перекус/.test(q)) return MOCK_RESPONSES.snacks;
  return MOCK_RESPONSES.general;
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

function ask(question) {
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

  responseTimer = setTimeout(() => {
    if (request !== generation) return;
    loading.remove();
    addAnswer(selectMock(question));
    pending = false;
    input.disabled = false;
    conversation.setAttribute('aria-busy', 'false');
    syncInput();
    document.querySelectorAll('.suggestion').forEach(btn => btn.disabled = false);
    input.focus({ preventScroll: true });
  }, 1000);
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
  settingsForm.addEventListener('submit', (e) => {
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

    saveProfile(updated);

    const toast = document.querySelector('#settings-toast');
    if (toast) {
      toast.hidden = false;
      setTimeout(() => { toast.hidden = true; }, 2500);
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
  resetMealsDataBtn.addEventListener('click', () => {
    loggedMeals = [];
    saveMeals();
    alert('Дневник питания сброшен.');
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

// INITIAL APP START
switchView('chat');
syncInput();
