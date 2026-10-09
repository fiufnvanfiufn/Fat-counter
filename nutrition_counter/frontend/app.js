// MOCK DATA: handcrafted demo responses and fictional article excerpts.
// No LLM, BM25, API calls or actual document retrieval are implemented.
const MOCK_SOURCES = {
  protein: { title: 'Источники белка в повседневном рационе', description: 'Демонстрационная статья о разнообразии белковых продуктов: птице, рыбе, яйцах, бобовых и тофу.' },
  alternatives: { title: 'Как выбирать альтернативы мясу', description: 'Демонстрационный обзор замен привычных продуктов с учётом вкуса, способа приготовления и состава блюда.' },
  plate: { title: 'Принцип сбалансированной тарелки', description: 'Демонстрационная статья о сочетании овощей, источника белка и гарнира в одном приёме пищи.' },
  habits: { title: 'Простые привычки в питании', description: 'Демонстрационный материал о планировании еды и постепенных изменениях повседневного рациона.' },
  snacks: { title: 'Идеи для повседневного перекуса', description: 'Демонстрационная подборка простых сочетаний продуктов для перекуса.' }
};
const MOCK_RESPONSES = {
  alternatives: { intro: 'В качестве замены свинине можно рассмотреть несколько продуктов — выбор зависит от блюда и ваших предпочтений.', items: ['Курица или индейка — для запекания, тушения и домашних котлет.', 'Рыба — как отдельное основное блюдо с привычным гарниром.', 'Чечевица, фасоль или тофу — для рагу, салатов и блюд без мяса.'], end: 'Начните с одного знакомого блюда: например, попробуйте приготовить рагу с фасолью. Вкус во многом задают овощи и специи.', sources: ['alternatives', 'protein'] },
  protein: { intro: 'Белковые продукты могут быть как животного, так и растительного происхождения. В демонстрационном рационе можно сочетать разные варианты.', items: ['Птица, рыба и яйца.', 'Творог и натуральный йогурт.', 'Чечевица, фасоль, нут и тофу.'], end: 'Добавьте привычный источник белка к овощам и гарниру. Конкретный состав и размер порции зависят от ваших потребностей.', sources: ['protein', 'plate'] },
  plate: { intro: 'Чтобы собрать обед, удобно подумать о трёх частях блюда: овощах, источнике белка и гарнире.', items: ['Овощи — свежие, запечённые или тушёные.', 'Источник белка — например, рыба, птица, фасоль или тофу.', 'Гарнир — например, гречка, рис или картофель.'], end: 'Пример сочетания: гречка, запечённая индейка и овощной салат. Используйте эту идею как отправную точку для своих любимых продуктов.', sources: ['plate', 'habits'] },
  snacks: { intro: 'Для перекуса можно выбрать простое сочетание продуктов, которое удобно взять с собой.', items: ['Натуральный йогурт с ягодами.', 'Фрукт и небольшая порция орехов.', 'Цельнозерновой тост с хумусом.'], end: 'Выбирайте вариант с учётом вкуса, переносимости продуктов и того, насколько вы голодны.', sources: ['snacks', 'habits'] },
  general: { intro: 'Вопрос принят. Это макет: для свободного запроса пока показывается общий демонстрационный ответ, который не анализирует ваш вопрос.', items: ['Добавляйте разнообразные продукты в привычные блюда.', 'Продумывайте удобные варианты основных приёмов пищи и перекусов.', 'Выбирайте небольшие изменения, которые легко повторять каждый день.'], end: 'Для примера более конкретного ответа попробуйте спросить: «Чем заменить свинину в рационе?» или «Какие продукты богаты белком?»', sources: ['plate', 'habits'] }
};

const form = document.querySelector('#chat-form');
const input = document.querySelector('#question');
const send = document.querySelector('#send');
const conversation = document.querySelector('#conversation');
const welcome = document.querySelector('#welcome');
const dialog = document.querySelector('#source-dialog');
let pending = false;
let generation = 0;
let responseTimer;

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${name}`); svg.append(use); return svg;
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function syncInput() {
  send.disabled = pending || !input.value.trim();
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
}
function closeMenu() {
  document.body.classList.remove('menu-open');
  document.querySelector('#menu-button').setAttribute('aria-expanded', 'false');
}
function showSource(title, description) {
  document.querySelector('#source-title').textContent = title;
  document.querySelector('#source-description').textContent = description;
  closeMenu(); dialog.showModal();
}
function showSourceInfo() {
  showSource('Понятно, откуда берётся ответ', 'В полной версии помощник будет искать текстовые статьи алгоритмом BM25 и использовать их для ответа нейросети. Сейчас все ответы, названия и описания статей подготовлены вручную; карточки показывают будущий вид интерфейса.');
}
function assistantMessage() {
  const message = element('article', 'message assistant-message');
  const heading = element('div', 'assistant-heading');
  const avatar = element('span', 'avatar'); avatar.append(icon('leaf'));
  heading.append(avatar, element('span', '', 'Помощник по питанию'), element('span', 'mock-tag', 'ДЕМО-ОТВЕТ'));
  message.append(heading); return message;
}
function selectMock(question) {
  const q = question.toLocaleLowerCase('ru');
  if (/свинин|замен|альтернатив/.test(q)) return MOCK_RESPONSES.alternatives;
  if (/бел[ко]|протеин/.test(q)) return MOCK_RESPONSES.protein;
  if (/обед|сбаланс|тарелк/.test(q)) return MOCK_RESPONSES.plate;
  if (/перекус/.test(q)) return MOCK_RESPONSES.snacks;
  return MOCK_RESPONSES.general;
}
function scrollToMessage(message) {
  message.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
}
function addAnswer(mock) {
  const message = assistantMessage();
  const body = element('div', 'answer-body');
  body.append(element('p', '', mock.intro));
  const list = element('ul'); mock.items.forEach(item => list.append(element('li', '', item)));
  body.append(list, element('p', '', mock.end));
  const heading = element('div', 'source-heading');
  heading.append(icon('book'), element('span', '', 'Демонстрационные источники · 2'));
  const cards = element('div', 'source-cards');
  mock.sources.forEach((id, index) => {
    const source = MOCK_SOURCES[id];
    const card = element('button', 'source-card'); card.type = 'button';
    const content = element('span');
    content.append(element('strong', '', source.title), element('small', '', 'Пример статьи · открыть описание'));
    card.append(element('span', 'source-number', `0${index + 1}`), content);
    card.addEventListener('click', () => showSource(source.title, source.description));
    cards.append(card);
  });
  body.append(heading, cards, element('p', 'answer-note', 'Заготовленный пример для знакомства с интерфейсом.'));
  message.append(body); conversation.append(message); scrollToMessage(message);
}
function ask(question) {
  if (pending || !question.trim()) return;
  pending = true; const request = ++generation;
  closeMenu(); welcome.hidden = true; conversation.hidden = false;
  const user = element('article', 'message user-message');
  user.append(element('div', 'user-bubble', question.trim())); conversation.append(user);
  const loading = assistantMessage();
  const status = element('div', 'typing'); status.setAttribute('role', 'status');
  const dots = element('span', 'typing-dots'); dots.setAttribute('aria-hidden', 'true');
  dots.append(element('i'), element('i'), element('i'));
  status.append(dots, element('span', '', 'Готовлю демонстрационный ответ…'));
  loading.append(status); conversation.append(loading);
  input.value = ''; input.disabled = true; conversation.setAttribute('aria-busy', 'true'); syncInput();
  document.querySelectorAll('.suggestion').forEach(button => button.disabled = true);
  scrollToMessage(user);
  responseTimer = setTimeout(() => {
    if (request !== generation) return;
    loading.remove(); addAnswer(selectMock(question));
    pending = false; input.disabled = false; conversation.setAttribute('aria-busy', 'false'); syncInput();
    document.querySelectorAll('.suggestion').forEach(button => button.disabled = false);
    input.focus({ preventScroll: true });
  }, 1200);
}
function resetChat() {
  generation++; clearTimeout(responseTimer); pending = false;
  conversation.replaceChildren(); conversation.hidden = true; conversation.removeAttribute('aria-busy');
  welcome.hidden = false; input.disabled = false; input.value = '';
  document.querySelectorAll('.suggestion').forEach(button => button.disabled = false);
  syncInput(); closeMenu(); window.scrollTo(0, 0); input.focus({ preventScroll: true });
}
input.addEventListener('input', syncInput);
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); ask(input.value); }
});
form.addEventListener('submit', event => { event.preventDefault(); ask(input.value); });
document.querySelectorAll('.suggestion').forEach(button => button.addEventListener('click', () => ask(button.dataset.question)));
document.querySelector('#new-chat').addEventListener('click', resetChat);
document.querySelector('#assistant-nav').addEventListener('click', () => { closeMenu(); input.focus(); });
document.querySelector('#sources-nav').addEventListener('click', showSourceInfo);
document.querySelector('#top-sources').addEventListener('click', showSourceInfo);
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
document.querySelector('#dialog-done').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } });
document.querySelector('#menu-button').addEventListener('click', () => {
  const open = document.body.classList.toggle('menu-open');
  document.querySelector('#menu-button').setAttribute('aria-expanded', String(open));
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
document.addEventListener('click', event => { if (document.body.classList.contains('menu-open') && !event.target.closest('#sidebar, #menu-button')) closeMenu(); });
