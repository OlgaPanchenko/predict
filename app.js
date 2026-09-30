'use strict';
const APP_VERSION = '4';
window.PREDICT_LOADED = true; // меняй вместе с ?v= в index.html
const tg = window.Telegram && window.Telegram.WebApp;
try { tg.ready(); tg.expand(); tg.setHeaderColor('#0b0c0a'); tg.setBackgroundColor('#0b0c0a'); } catch (_) {}

const qs = new URLSearchParams(location.search);
const API = qs.get('api') || window.API_URL || '';
const AUTH = (tg && tg.initData) || (qs.get('dev') ? `dev:${qs.get('dev')}:${encodeURIComponent(qs.get('name') || 'Dev ' + qs.get('dev'))}` : '');
const START = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || qs.get('ev') || null; // ссылка t.me/бот/predict?startapp=<id>
const $app = document.getElementById('app');

let S = null;
const ui = { ev: START, view: START ? 'event' : 'home', draft: null, q: '', form: null, confirm: false };

// ---------- утилиты ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastT;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
function haptic(kind) {
  try {
    if (kind === 'ok') tg.HapticFeedback.notificationOccurred('success');
    else if (kind === 'err') tg.HapticFeedback.notificationOccurred('error');
    else tg.HapticFeedback.selectionChanged();
  } catch (_) {}
}
function ask(msg) {
  return new Promise(res => {
    try { if (tg && tg.isVersionAtLeast('6.2')) return tg.showConfirm(msg, res); } catch (_) {}
    res(window.confirm(msg));
  });
}
async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); haptic('ok'); return; } catch (_) {}
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast(okMsg); } catch (_) { toast('Не получилось скопировать'); }
  ta.remove();
}
const medal = k => k < 3 ? ['gold', 'silver', 'bronze'][k] : '';
const STATUS = { open: ['Приём открыт', 'live'], closed: ['Приём закрыт', ''], done: ['Итоги', 'done'] };

// ---------- сервер ----------
let inflight = 0;
async function call(action, payload) {
  inflight++;
  try {
    let j;
    try {
      // не ждём бесконечно: через 30 секунд — понятная ошибка вместо вечной «Загрузки»
      const ctrl = window.AbortController ? new AbortController() : null;
      const timer = ctrl && setTimeout(() => ctrl.abort(), 30000);
      const r = await fetch(API, { method: 'POST', body: JSON.stringify(Object.assign({ action, auth: AUTH }, payload || {})), signal: ctrl ? ctrl.signal : undefined });
      clearTimeout(timer);
      j = await r.json();
    } catch (_) { j = { error: 'Нет связи с сервером. Закрой окно и открой ссылку ещё раз.' }; }
    if (j.error) throw new Error(j.error);
    if (!j.same) { S = j; render(); }
    return j;
  } finally { inflight--; }
}
async function load(force) {
  if (inflight && S && !force) return;
  if (!S) $app.innerHTML = '<div class="loading">Загрузка… связываюсь с сервером</div>';
  try { await call('state', { v: S && !force ? S.version : 0 }); }
  catch (e) { if (!S) $app.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function act(action, body, okMsg) {
  try {
    const j = await call(action, body || {});
    toast(j.notice || okMsg || 'Готово'); haptic('ok'); return true;
  } catch (e) { toast(e.message); haptic('err'); load(true); return false; }
}

// ---------- рендер ----------
let pending = false;
function render() {
  try { renderInner(); } catch (e) {
    $app.innerHTML = `<div class="empty">Ошибка отображения: ${esc(e.message)}<br><small>версия ${APP_VERSION}</small></div>`;
  }
}
function renderInner() {
  if (document.activeElement && document.activeElement.matches('#app input, #app textarea')) { pending = true; return; }
  pending = false;
  if (!S) return;
  const ev = ui.ev && S.events.find(e => e.id === ui.ev);
  if (ui.view === 'event' && !ev) { ui.view = 'home'; ui.ev = null; }
  $app.innerHTML = ui.view === 'form' ? renderForm() : ui.view === 'event' ? renderEvent(ev) : renderHome();
}
document.addEventListener('focusout', () => setTimeout(() => { if (pending) render(); }, 0));

function topBar(sub) {
  return `<div class="bar"><img class="logo" src="logo.png" alt="Mafia News Drop"><span class="sub"><b>Прогнозы</b>${sub ? esc(sub) : 'на турниры'}</span></div>`;
}

function renderHome() {
  const evs = S.events;
  const cards = evs.map(e => {
    const [st, cls] = STATUS[e.status];
    const mine = e.my ? '<span class="tag ok">Твой прогноз принят</span>' : e.status === 'open' ? '<span class="tag go">Сделай прогноз</span>' : '';
    return `<button class="ev-card" data-open="${esc(e.id)}">
      <span class="ev-top"><span class="status ${cls}">${st}</span><span class="muted">${esc(e.modeLabel)}</span></span>
      <span class="ev-title">${esc(e.title)}</span>
      <span class="ev-foot">${mine}${S.me.isAdmin ? `<span class="muted">Прогнозов: ${e.count}</span>` : ''}</span>
    </button>`;
  }).join('');
  return topBar() + `
    <div class="intro"><h1>Угадай призёров турнира</h1>
      <p class="muted">Выбери тройку призёров или топ-10 игроков по порядку. Прогноз делается один раз — изменить его нельзя, чужие прогнозы никто не видит. После турнира покажем, кто угадал.</p></div>
    ${S.me.isAdmin ? '<button class="btn primary" data-act="new">Новый прогноз</button>' : ''}
    ${cards || '<div class="card empty">Пока нет открытых прогнозов. Следи за каналом — ссылка появится в посте.</div>'}
    <p class="muted center ver">Версия ${APP_VERSION}</p>`;
}

function renderForm() {
  const f = ui.form;
  const players = parseList(f.text);
  return topBar('новый прогноз') + `
    <button class="back" data-act="home">← Назад</button>
    <div class="card"><h3>Новый прогноз</h3>
      <input class="field" data-f="title" placeholder="Название турнира" value="${esc(f.title)}">
      <p class="muted" style="margin:12px 0 0">Что угадывают</p>
      <div class="chips">
        <button class="chip ${f.mode === 'top3' ? 'on' : ''}" data-mode="top3">Тройка призёров</button>
        <button class="chip ${f.mode === 'top10' ? 'on' : ''}" data-mode="top10">Топ-10 по порядку</button>
      </div>
      <p class="muted">${f.mode === 'top3'
        ? 'Итоги в двух списках: кто угадал тройку в точном порядке и кто угадал состав тройки.'
        : 'Побеждает, кто угадал все 10 мест. Если таких нет — покажем лучших по числу угаданных мест.'}</p>
      <textarea class="field paste" data-f="text" rows="8" placeholder="Игроки турнира — по одному в строке.\nМожно с номерами: 1. Ник, 2) Ник…">${esc(f.text)}</textarea>
      <p class="muted" id="cnt">Игроков в списке: ${players.length}</p>
      <button class="btn primary" data-act="create">Запустить прогноз</button>
    </div>`;
}

/** Список игроков: по строке, номера в начале срезаются, пустые строки и повторы убираются. */
function parseList(text) {
  const seen = new Set();
  return String(text || '').split(/\r?\n/).map(s => s.replace(/^\s*(№\s*)?\d{1,3}\s*[.)\-:]?\s+/, '').trim())
    .filter(s => { const k = s.toLowerCase(); if (!s || seen.has(k)) return false; seen.add(k); return true; });
}

function renderEvent(ev) {
  const [st, cls] = STATUS[ev.status];
  const name = i => ev.players[i - 1];
  let body = '';

  if (ev.status === 'done') body += resultCard(ev);

  // прогноз зрителя
  if (ev.my) body += myCard(ev);
  else if (ev.status === 'open' && !(ui.draft && ui.draft.kind === 'results')) body += picker(ev, 'pick');
  else if (ev.status !== 'open' && !S.me.isAdmin) body += `<div class="card empty">Приём прогнозов закрыт${ev.status === 'done' ? '' : ' — итоги появятся после турнира'}.</div>`;

  if (S.me.isAdmin) body += adminCard(ev);

  return topBar(ev.modeLabel) + `
    <button class="back" data-act="home">← Все прогнозы</button>
    <div class="ev-head"><span class="status ${cls}">${st}</span><h1>${esc(ev.title)}</h1>
      <p class="muted">${ev.need === 3 ? 'Угадай тройку призёров: кто займёт 1, 2 и 3 место.' : 'Угадай топ-10 игроков турнира в правильном порядке.'}</p></div>
    ${body}`;

  function myCard(ev) {
    const res = ev.results;
    const rows = ev.my.picks.map((p, k) => {
      let mark = '';
      if (res) mark = res[k] === p ? '<span class="hit">✓</span>' : res.includes(p) && ev.need === 3 ? '<span class="near">в тройке</span>' : '<span class="miss">✗</span>';
      return `<li><span class="place ${medal(k)}">${k + 1}</span><span class="pname">${esc(name(p))}</span>${mark}</li>`;
    }).join('');
    const hits = res ? ev.my.picks.filter((p, k) => res[k] === p).length : 0;
    const sum = ev.summary || {};
    const sameSet = res && ev.need === 3 && ev.my.picks.every(p => res.includes(p));
    const win = !res ? '' : hits === ev.need ? (ev.need === 3 ? 'Ты угадал тройку в точном порядке!' : 'Ты угадал весь топ-10!')
      : sameSet ? 'Ты угадал состав тройки!' : ev.need === 10 && !(sum.exact || []).length && hits && hits === sum.bestHits ? `Ты ближе всех: ${hits} из 10!` : '';
    return `<div class="card"><h3>Твой прогноз</h3>${win ? `<p class="youwin">${win}</p>` : ''}<ol class="places">${rows}</ol>
      <p class="muted">${res ? `Угадано мест: <b class="${hits ? 'hit' : ''}">${hits} из ${ev.need}</b>` : 'Прогноз принят. Изменить его нельзя — ждём итогов турнира.'}</p></div>`;
  }
}

/** Выбор мест: слоты сверху, поиск и список игроков снизу. Нажатие на игрока — в первый пустой слот. */
function picker(ev, kind) {
  if (!ui.draft || ui.draft.ev !== ev.id || ui.draft.kind !== kind) {
    ui.draft = { ev: ev.id, kind, arr: Array(ev.need).fill(null) };
    if (kind === 'results' && ev.results) ui.draft.arr = ev.results.slice();
    ui.q = '';
  }
  const d = ui.draft;
  const filled = d.arr.filter(Boolean).length;
  const slots = d.arr.map((p, k) => `<button class="slot ${p ? 'full' : ''}" data-slot="${k}">
      <span class="place ${medal(k)}">${k + 1}</span><span class="pname">${p ? esc(ev.players[p - 1]) : '<span class="muted">выбери игрока</span>'}</span>${p ? '<span class="x">×</span>' : ''}</button>`).join('');
  const isRes = kind === 'results';
  return `<div class="card ${isRes ? 'res-edit' : ''}"><h3>${isRes ? 'Результаты турнира' : ev.need === 3 ? 'Твоя тройка призёров' : 'Твой топ-10'}</h3>
    <p class="muted">${isRes ? 'Отметь, кто занял какое место.' : 'Нажимай на игроков по порядку: первый — 1 место, второй — 2 и так далее. Нажми на место, чтобы освободить его.'}</p>
    <div class="slots">${slots}</div>
    <input class="field" data-f="q" placeholder="Поиск по нику" value="${esc(ui.q)}" autocomplete="off">
    <div class="plist" id="plist">${playerList(ev)}</div>
    <button class="btn primary" data-act="${isRes ? 'saveResults' : 'submit'}" ${filled === ev.need ? '' : 'disabled'}>
      ${isRes ? 'Сохранить результаты' : `Отправить прогноз${filled < ev.need ? ` · ${filled}/${ev.need}` : ''}`}</button>
    ${isRes ? '<button class="btn" data-act="cancelResults">Отмена</button>' : ''}
  </div>`;
}
function playerList(ev) {
  const d = ui.draft, q = ui.q.trim().toLowerCase();
  const items = ev.players.map((p, i) => [p, i + 1]).filter(([p, n]) => !d.arr.includes(n) && (!q || p.toLowerCase().includes(q)));
  return items.length ? items.map(([p, n]) => `<button class="pl" data-pl="${n}">${esc(p)}</button>`).join('')
    : `<p class="muted center">${q ? 'Никого не нашли' : 'Все места заполнены'}</p>`;
}

/** Карточка итогов — её удобно скриншотить для поста. */
function resultCard(ev) {
  const s = ev.summary || { exact: [], set: [], best: [], count: 0 };
  const who = arr => `<ul class="winners">${arr.map(x => `<li>${esc(x.name)}${x.username ? ` <span class="muted">@${esc(x.username)}</span>` : ''}</li>`).join('')}</ul>`;
  let win = '';
  if (ev.need === 3) {
    if (s.exact.length) win += `<h4>Угадали тройку в точном порядке · ${s.exact.length}</h4>${who(s.exact)}`;
    if (s.set.length) win += `<h4>Угадали состав тройки · ${s.set.length}</h4>${who(s.set)}`;
    if (!s.exact.length && !s.set.length) win += '<p class="nobody">Никто не угадал тройку призёров</p>';
  } else if (s.exact.length) win += `<h4>Угадали весь топ-10 · ${s.exact.length}</h4>${who(s.exact)}`;
  else if (s.best.length) win += `<p class="nobody">Точный топ-10 никто не угадал</p><h4>Ближе всех — ${s.bestHits} из 10 мест · ${s.best.length}</h4>${who(s.best)}`;
  else win += '<p class="nobody">Никто не угадал ни одного места</p>';
  return `<div class="result" id="result">
    <div class="r-head"><img class="logo" src="logo.png" alt=""><span>Итоги прогноза</span></div>
    <h2>${esc(ev.title)}</h2>
    <p class="r-sub">${ev.need === 3 ? 'Призёры турнира' : 'Топ-10 турнира'}</p>
    <ol class="places big">${ev.results.map((p, k) => `<li><span class="place ${medal(k)}">${k + 1}</span><span class="pname">${esc(ev.players[p - 1])}</span></li>`).join('')}</ol>
    <div class="r-win">${win}</div>
    <p class="r-foot">Всего прогнозов: ${s.count}</p>
  </div>`;
}

function adminCard(ev) {
  const link = S.link ? `${S.link}?startapp=${ev.id}` : '';
  let btns = '';
  if (ui.draft && ui.draft.kind === 'results' && ui.draft.ev === ev.id) return picker(ev, 'results');
  if (ev.status === 'open') btns = `
    <button class="btn primary" data-act="close">Закрыть приём прогнозов</button>
    ${link ? '<button class="btn" data-act="copyLink">Скопировать ссылку для поста</button>' : ''}
    <button class="btn danger" data-act="remove">Удалить прогноз</button>`;
  else if (ev.status === 'closed') btns = `
    <button class="btn primary" data-act="enterResults">Внести результаты турнира</button>
    <button class="btn" data-act="reopen">Открыть приём снова</button>
    <button class="btn danger" data-act="remove">Удалить прогноз</button>`;
  else btns = `
    <button class="btn primary" data-act="publish" ${S.channel ? '' : 'disabled'}>${ev.publishedAt ? 'Опубликовать в канал ещё раз' : 'Опубликовать в канал'}</button>
    ${S.channel ? '' : '<p class="muted">Чтобы публиковать, впиши CHANNEL_ID в свойства скрипта.</p>'}
    <button class="btn" data-act="copyPost">Скопировать текст итогов</button>
    <button class="btn" data-act="enterResults">Исправить результаты</button>
    <button class="btn danger" data-act="archive">Убрать в архив</button>`;
  return `<div class="card admin"><h3>Админ</h3>
    <p class="muted">Прогнозов: <b>${ev.count}</b> · игроков в списке: ${ev.players.length}${ev.publishedAt ? ' · итоги опубликованы' : ''}</p>
    ${btns}</div>`;
}

// ---------- события ----------
$app.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.f === 'q') {
    ui.q = el.value;
    const ev = S.events.find(x => x.id === ui.ev);
    const pl = document.getElementById('plist');
    if (ev && pl) pl.innerHTML = playerList(ev);
  } else if (el.dataset.f && ui.form) {
    ui.form[el.dataset.f] = el.value;
    if (el.dataset.f === 'text') document.getElementById('cnt').textContent = `Игроков в списке: ${parseList(el.value).length}`;
  }
});

$app.addEventListener('click', async e => {
  const el = e.target.closest('[data-open],[data-act],[data-mode],[data-slot],[data-pl]');
  if (!el) return;
  const ev = ui.ev && S.events.find(x => x.id === ui.ev);

  if (el.dataset.open) { ui.ev = el.dataset.open; ui.view = 'event'; ui.draft = null; haptic(); render(); window.scrollTo(0, 0); return; }
  if (el.dataset.mode) { ui.form.mode = el.dataset.mode; haptic(); return render(); }
  if (el.dataset.slot !== undefined) {
    const k = +el.dataset.slot;
    if (ui.draft.arr[k]) { ui.draft.arr[k] = null; haptic(); render(); }
    return;
  }
  if (el.dataset.pl) {
    const i = ui.draft.arr.indexOf(null);
    if (i < 0) return toast('Все места уже заполнены');
    ui.draft.arr[i] = +el.dataset.pl; haptic(); render();
    return;
  }

  switch (el.dataset.act) {
    case 'home': ui.view = 'home'; ui.ev = null; ui.draft = null; render(); window.scrollTo(0, 0); break;
    case 'new': ui.form = ui.form || { title: '', mode: 'top3', text: '' }; ui.view = 'form'; render(); break;
    case 'create': {
      const f = ui.form, players = parseList(f.text);
      if (!f.title.trim()) return toast('Укажи название турнира');
      if (!(await ask(`Запустить прогноз «${f.title.trim()}»? Игроков: ${players.length}. После запуска список не меняется.`))) break;
      if (await act('admin_create', { title: f.title, mode: f.mode, players }, 'Прогноз запущен')) {
        ui.form = null; ui.ev = S.events[0] && S.events[0].id; ui.view = 'event'; render();
      }
      break;
    }
    case 'submit': {
      const names = ui.draft.arr.map((p, k) => `${k + 1}. ${ev.players[p - 1]}`).join('\n');
      if (!(await ask(`Твой прогноз:\n${names}\n\nИзменить его потом будет нельзя. Отправить?`))) break;
      if (await act('submit', { ev: ev.id, picks: ui.draft.arr }, 'Прогноз принят!')) ui.draft = null, render();
      break;
    }
    case 'close': if (await ask('Закрыть приём прогнозов? Новые прогнозы больше не принимаются.')) act('admin_close', { ev: ev.id }, 'Приём закрыт'); break;
    case 'reopen': act('admin_reopen', { ev: ev.id }, 'Приём снова открыт'); break;
    case 'enterResults': ui.draft = null; ui.draft = { ev: ev.id, kind: 'results', arr: ev.results ? ev.results.slice() : Array(ev.need).fill(null) }; ui.q = ''; render(); break;
    case 'cancelResults': ui.draft = null; render(); break;
    case 'saveResults': {
      const names = ui.draft.arr.map((p, k) => `${k + 1}. ${ev.players[p - 1]}`).join('\n');
      if (!(await ask(`Результаты:\n${names}\n\nСохранить и определить победителей?`))) break;
      if (await act('admin_results', { ev: ev.id, results: ui.draft.arr }, 'Итоги готовы')) { ui.draft = null; render(); window.scrollTo(0, 0); }
      break;
    }
    case 'publish': if (await ask('Опубликовать итоги в канал?')) act('admin_publish', { ev: ev.id }); break;
    case 'copyPost': copy(ev.post, 'Текст итогов скопирован'); break;
    case 'copyLink': copy(`${S.link}?startapp=${ev.id}`, 'Ссылка скопирована — вставь её в пост'); break;
    case 'archive':
      if (await ask('Убрать в архив? Прогнозы зрителей удалятся из таблицы, итог останется на листе «Итоги».'))
        if (await act('admin_archive', { ev: ev.id }, 'Убрано в архив')) { ui.view = 'home'; ui.ev = null; render(); }
      break;
    case 'remove':
      if (await ask('Удалить прогноз вместе со всеми прогнозами зрителей? Это нельзя отменить.'))
        if (await act('admin_remove', { ev: ev.id }, 'Прогноз удалён')) { ui.view = 'home'; ui.ev = null; render(); }
      break;
  }
});

// ---------- старт ----------
if (!API || API.includes('ВСТАВЬ_СЮДА')) {
  $app.innerHTML = '<div class="empty">Не указан адрес Google-скрипта в <b>config.js</b>.</div>';
} else if (!AUTH) {
  $app.innerHTML = '<div class="empty">Открой прогнозы через Telegram.<br><br>Для проверки в браузере добавь к адресу <b>?dev=1</b> (админ) или <b>?dev=2</b> (зритель).</div>';
} else {
  load();
  // статусы меняются редко: проверяем раз в 15 секунд, без изменений скрипт отвечает коротким «same»
  setInterval(() => { if (!document.hidden) load(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
}
