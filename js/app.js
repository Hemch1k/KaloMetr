/* ===== КалоМетр — логика приложения ===== */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const state = {
    dateKey: Store.dateKey(),
    meal: 'breakfast',
    activeCat: 'Все',
    editId: null,
    photo: { file: null, items: [] },
    foodCache: null,
    remoteSeq: 0,
    remoteTimer: null,
  };

  /* ---------- Утилиты ---------- */
  const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function parseKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function ruDate(d, opts) {
    return d.toLocaleDateString('ru-RU', opts);
  }

  function titleForKey(key) {
    const today = Store.dateKey();
    const yest = Store.dateKey(new Date(Date.now() - 864e5));
    if (key === today) return 'Сегодня';
    if (key === yest) return 'Вчера';
    return ruDate(parseKey(key), { day: 'numeric', month: 'long' });
  }

  function defaultMeal() {
    const h = new Date().getHours();
    if (h < 11) return 'breakfast';
    if (h < 16) return 'lunch';
    if (h < 22) return 'dinner';
    return 'snack';
  }

  const CAT_EMOJI = {
    'Мясо и птица': '🍗', 'Рыба': '🐟', 'Молочные': '🥛', 'Крупы': '🍚',
    'Хлеб': '🍞', 'Овощи': '🥦', 'Фрукты': '🍎', 'Орехи': '🥜',
    'Сладости': '🍫', 'Напитки': '🥤', 'Масла и соусы': '🫒',
    'Фастфуд': '🍔', 'Готовые блюда': '🍲', 'Яйца': '🥚', 'Из интернета': '🌍',
  };
  const emojiFor = (f) => f.emoji || CAT_EMOJI[f.cat] || '🍽️';

  function allFoods() {
    if (!state.foodCache) state.foodCache = [...Store.customFoods(), ...FOODS];
    return state.foodCache;
  }
  function foodById(id) {
    if (!id) return undefined;
    return Store.cachedFood(id) || allFoods().find((f) => f.id === id);
  }

  /* ---------- Навигация ---------- */
  function showScreen(name) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
    $$('[data-screen]').forEach((b) => b.classList.toggle('active', b.dataset.screen === name));
    if (name === 'history') renderHistory();
    if (name === 'settings') renderSettings();
    window.scrollTo({ top: 0 });
  }

  /* ---------- Экран «Сегодня» ---------- */
  function renderToday() {
    const key = state.dateKey;
    const t = Store.totalsFor(key);
    const s = Store.settings();

    $('#dayTitle').textContent = titleForKey(key);
    $('#daySubtitle').textContent = ruDate(parseKey(key), { weekday: 'long', day: 'numeric', month: 'long' });
    $('#nextDay').disabled = key >= Store.dateKey();
    $('#nextDay').style.opacity = key >= Store.dateKey() ? .35 : 1;

    const goal = s.goal || 2000;
    const eaten = Math.round(t.kcal);
    const left = Math.max(0, goal - eaten);
    const pct = clamp(t.kcal / goal, 0, 1);

    $('#kcalEaten').textContent = fmt(eaten);
    $('#kcalGoal').textContent = fmt(goal);
    $('#kcalBurned').textContent = Math.round(clamp((t.kcal / goal) * 100, 0, 999)) + '%';
    $('#kcalLeft').textContent = eaten > goal ? `+${fmt(eaten - goal)}` : fmt(left);

    const CIRC = 2 * Math.PI * 52;
    const ring = $('#ringFg');
    ring.style.strokeDashoffset = CIRC * (1 - pct);
    ring.classList.toggle('over', t.kcal > goal);

    setMacro('P', t.p, s.proteinGoal);
    setMacro('F', t.f, s.fatGoal);
    setMacro('C', t.c, s.carbGoal);

    renderMeals();
  }

  function setMacro(id, val, goal) {
    const g = goal || 1;
    $(`#macro${id}`).textContent = `${Math.round(val)} / ${Math.round(g)} г`;
    $(`#bar${id}`).style.setProperty('--w', `${clamp((val / g) * 100, 0, 100)}%`);
  }

  function renderMeals() {
    const key = state.dateKey;
    const entries = Store.entriesFor(key);
    const wrap = $('#meals');
    wrap.innerHTML = '';

    MEALS.forEach((m) => {
      const list = entries.filter((e) => e.meal === m.id);
      const sum = list.reduce((a, e) => a + e.kcal, 0);
      const card = document.createElement('div');
      card.className = 'card meal-card';

      const head = document.createElement('div');
      head.className = 'meal-head';
      head.innerHTML = `
        <div>
          <div class="meal-name"><span>${m.emoji}</span><span>${m.label}</span>
            <span class="meal-kcal">${fmt(sum)} ккал</span></div>
        </div>`;
      const addBtn = document.createElement('button');
      addBtn.className = 'meal-add';
      addBtn.textContent = '＋';
      addBtn.title = `Добавить в «${m.label}»`;
      addBtn.addEventListener('click', () => openAdd(m.id));
      head.appendChild(addBtn);
      card.appendChild(head);

      if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'meal-sub';
        empty.textContent = 'Пока пусто';
        card.appendChild(empty);
      } else {
        list.forEach((e) => {
          const row = document.createElement('div');
          row.className = 'entry';
          row.innerHTML = `
            <div class="entry-main">
              <div class="entry-name"></div>
              <div class="entry-meta">${fmt(e.grams)} г · ${fmt(e.kcal100)} ккал/100 г${e.source === 'photo' ? ' · 📷' : ''}</div>
            </div>
            <div class="entry-kcal">${fmt(e.kcal)}</div>
            <button class="entry-del" title="Удалить">✕</button>`;
          row.querySelector('.entry-name').textContent = e.name;
          row.querySelector('.entry-main').addEventListener('click', () => openPortionEdit(e));
          row.querySelector('.entry-del').addEventListener('click', (ev) => {
            ev.stopPropagation();
            Store.deleteEntry(key, e.id);
            renderToday();
            toast('Запись удалена');
          });
          card.appendChild(row);
        });
      }
      wrap.appendChild(card);
    });
  }

  function shiftDay(delta) {
    const d = parseKey(state.dateKey);
    d.setDate(d.getDate() + delta);
    const key = Store.dateKey(d);
    if (key > Store.dateKey()) return;
    state.dateKey = key;
    renderToday();
  }

  /* ---------- Шторки ---------- */
  function openOverlay(id) { $(`#${id}`).classList.add('open'); document.body.style.overflow = 'hidden'; }
  function closeOverlay(id) { $(`#${id}`).classList.remove('open'); document.body.style.overflow = ''; }

  function openAdd(mealId) {
    state.meal = mealId || state.meal || defaultMeal();
    state.editId = null;
    $('#searchInput').value = '';
    renderSearch('');
    renderFavs();
    resetPhoto();
    switchTab('search');
    openOverlay('addOverlay');
    setTimeout(() => { if (window.innerWidth > 860) $('#searchInput').focus(); }, 250);
  }

  function switchTab(name) {
    $$('#addTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $$('#addSheet .tab-pane').forEach((p) => p.classList.toggle('active', p.id === `pane-${name}`));
    if (name === 'fav') renderFavs();
  }

  /* ---------- Поиск ---------- */
  function searchFoods(q, cat) {
    const query = q.trim().toLowerCase();
    const favs = Store.favorites();
    let list = allFoods();

    if (cat && cat !== 'Все') list = list.filter((f) => f.cat === cat);

    if (query) {
      const scored = [];
      list.forEach((f) => {
        const name = f.n.toLowerCase();
        const aliases = (f.a || []).map((a) => a.toLowerCase());
        let score = -1;
        if (name.startsWith(query)) score = 100;
        else if (name.includes(query)) score = 80;
        else if (aliases.some((a) => a.startsWith(query))) score = 60;
        else if (aliases.some((a) => a.includes(query))) score = 40;
        else if (query.length > 2 && (name.includes(query.slice(0, -1)) || aliases.some((a) => a.includes(query.slice(0, -1))))) score = 20;
        if (score >= 0) scored.push({ f, score: score + (favs.includes(f.id) ? 15 : 0) });
      });
      return scored.sort((a, b) => b.score - a.score).map((x) => x.f);
    }
    return favs.map(foodById).filter(Boolean).concat(list.filter((f) => !favs.includes(f.id)));
  }

  function renderSearch(q) {
    const box = $('#searchResults');
    const results = searchFoods(q, state.activeCat);
    scheduleRemote(q);

    if (!results.length) {
      box.innerHTML = `<div class="no-results"><b>Ничего не найдено</b>
        Попробуйте другой запрос или добавьте продукт вручную
        <div style="margin-top:14px"><button class="btn btn-ghost" id="addCustomBtn">＋ Свой продукт «${q.trim() || '...'}»</button></div>
      </div>`;
      $('#addCustomBtn').addEventListener('click', () => {
        openPortionAdd({
          id: '__custom',
          n: q.trim() || 'Продукт',
          k: 0, p: 0, f: 0, c: 0,
          cat: 'Прочее', custom: true,
        });
      });
      return;
    }
    box.innerHTML = '';
    results.slice(0, 60).forEach((f) => box.appendChild(resultRow(f)));
  }

  function resultRow(f) {
    const favs = Store.favorites();
    const btn = document.createElement('button');
    btn.className = 'result';
    btn.innerHTML = `
      <span class="result-emoji">${emojiFor(f)}</span>
      <span class="result-main">
        <span class="result-name"></span>
        <span class="result-sub">${f.k} ккал/100 г · Б${f.p} · Ж${f.f} · У${f.c}</span>
      </span>
      <span class="result-kcal">${f.k}</span>
      <span class="result-fav ${favs.includes(f.id) ? 'on' : ''}">★</span>`;
    btn.querySelector('.result-name').textContent = f.n;
    btn.addEventListener('click', (e) => {
      if (e.target.classList.contains('result-fav')) {
        const on = Store.toggleFavorite(f.id);
        e.target.classList.toggle('on', on);
        toast(on ? 'В избранное ★' : 'Убрано из избранного');
        return;
      }
      openPortionAdd(f);
    });
    return btn;
  }

  function scheduleRemote(q) {
    const seq = ++state.remoteSeq;
    const query = (q || '').trim();
    const head = $('#remoteHead');
    const box = $('#remoteResults');
    clearTimeout(state.remoteTimer);
    box.innerHTML = '';

    if (query.length < 2 || state.activeCat !== 'Все') {
      head.hidden = true;
      head.innerHTML = '';
      return;
    }
    head.hidden = false;
    head.innerHTML = '<span class="spinner"></span>Ищу в открытой базе Open Food Facts…';

    state.remoteTimer = setTimeout(async () => {
      if (seq !== state.remoteSeq) return;
      try {
        const items = await OpenFood.search(query);
        if (seq !== state.remoteSeq) return;
        if (!items.length) {
          head.innerHTML = '🌍 В интернете по запросу ничего не нашлось';
          return;
        }
        head.innerHTML = `🌍 Из интернета · Open Food Facts · ${items.length}`;
        items.forEach((f) => box.appendChild(remoteRow(f)));
      } catch (err) {
        if (seq !== state.remoteSeq) return;
        head.innerHTML = '🌍 Интернет-поиск сейчас недоступен (нет сети или база перегружена) — показаны локальные результаты';
      }
    }, 550);
  }

  function remoteRow(f) {
    const favs = Store.favorites();
    const btn = document.createElement('button');
    btn.className = 'result';
    const thumb = f.img
      ? `<img class="result-img" src="${f.img}" alt="" onerror="this.parentElement.textContent='🌍'">`
      : '🌍';
    btn.innerHTML = `
      <span class="result-emoji">${thumb}</span>
      <span class="result-main">
        <span class="result-name"></span>
        <span class="result-sub"></span>
      </span>
      <span class="result-kcal">${f.k}</span>
      <span class="result-fav ${favs.includes(f.id) ? 'on' : ''}">★</span>`;
    btn.querySelector('.result-name').textContent = f.n;
    btn.querySelector('.result-sub').textContent =
      `${f.k} ккал/100 г · Б${f.p} · Ж${f.f} · У${f.c}${f.brand ? ' · ' + f.brand : ''}`;
    btn.addEventListener('click', (e) => {
      if (e.target.classList.contains('result-fav')) {
        Store.cacheFood(f); // чтобы избранное работало и офлайн
        const on = Store.toggleFavorite(f.id);
        e.target.classList.toggle('on', on);
        toast(on ? 'В избранное ★' : 'Убрано из избранного');
        return;
      }
      Store.cacheFood(f);
      openPortionAdd(f);
    });
    return btn;
  }

  function renderFavs() {
    const box = $('#favResults');
    const favs = Store.favorites().map(foodById).filter(Boolean);
    if (!favs.length) {
      box.innerHTML = `<div class="no-results"><b>Избранное пусто</b>Нажмите ★ на продукте в поиске, чтобы закрепить его здесь</div>`;
      return;
    }
    box.innerHTML = '';
    favs.forEach((f) => box.appendChild(resultRow(f)));
  }

  /* ---------- Шторка «Порция» ---------- */
  function portionFoodData(f) {
    return {
      name: f.n,
      grams: 100,
      kcal100: f.k,
      p: f.p, f: f.f, c: f.c,
      foodId: f.id,
    };
  }

  function openPortionAdd(f) {
    state.editId = null;
    const data = portionFoodData(f);
    $('#portionTitle').textContent = f.custom ? 'Свой продукт' : 'Порция';
    $('#portionName').textContent = data.name;
    $('#portionPer100').textContent = `${data.kcal100} ккал / 100 г`;
    $('#portionGrams').value = 100;
    $('#portionNameInput').value = data.name;
    $('#portionKcal100').value = data.kcal100;
    $('#portionMeal').value = state.meal;
    $('#portionSaveBtn').textContent = 'Добавить';
    $('#portionDeleteBtn').hidden = true;
    $('#portionHint').textContent = data.kcal100 === 0
      ? 'Укажите название, вес и калорийность на 100 г — данные можно найти в интернете.'
      : '';
    updatePortionCalc(data);
    openOverlay('portionOverlay');
  }

  function openPortionEdit(e) {
    state.editId = e.id;
    $('#portionTitle').textContent = 'Редактирование';
    $('#portionName').textContent = e.name;
    $('#portionPer100').textContent = `${fmt(e.kcal100)} ккал / 100 г`;
    $('#portionGrams').value = e.grams;
    $('#portionNameInput').value = e.name;
    $('#portionKcal100').value = e.kcal100;
    $('#portionMeal').value = e.meal;
    $('#portionSaveBtn').textContent = 'Сохранить';
    $('#portionDeleteBtn').hidden = false;
    $('#portionHint').textContent = '';
    updatePortionCalc({ p: e.p / (e.grams / 100), f: e.f / (e.grams / 100), c: e.c / (e.grams / 100) });
    // сохраняем исходные нутриенты на 100 г для пересчёта
    openPortionEdit._base = {
      p100: e.grams ? (e.p / e.grams) * 100 : 0,
      f100: e.grams ? (e.f / e.grams) * 100 : 0,
      c100: e.grams ? (e.c / e.grams) * 100 : 0,
    };
    recalcPortion();
    openOverlay('portionOverlay');
  }

  function currentPortion() {
    const grams = clamp(Number($('#portionGrams').value) || 0, 0, 5000);
    const kcal100 = clamp(Number($('#portionKcal100').value) || 0, 0, 900);
    const name = $('#portionNameInput').value.trim() || 'Продукт';
    const meal = $('#portionMeal').value;
    const k = grams / 100 * kcal100;
    const base = openPortionEdit._base;
    let p100 = base?.p100, f100 = base?.f100, c100 = base?.c100;
    if (p100 === undefined) { p100 = Number($('#portionP').dataset.v100) || 0; f100 = Number($('#portionF').dataset.v100) || 0; c100 = Number($('#portionC').dataset.v100) || 0; }
    return {
      name, grams, kcal100, meal,
      kcal: k,
      p: grams / 100 * (p100 || 0),
      f: grams / 100 * (f100 || 0),
      c: grams / 100 * (c100 || 0),
      p100: p100 || 0, f100: f100 || 0, c100: c100 || 0,
    };
  }

  function updatePortionCalc(data) {
    $('#portionP').dataset.v100 = data.p || 0;
    $('#portionF').dataset.v100 = data.f || 0;
    $('#portionC').dataset.v100 = data.c || 0;
    delete openPortionEdit._base;
    recalcPortion();
  }

  function recalcPortion() {
    const g = clamp(Number($('#portionGrams').value) || 0, 0, 5000);
    const k100 = clamp(Number($('#portionKcal100').value) || 0, 0, 900);
    const base = openPortionEdit._base;
    const p100 = base ? base.p100 : Number($('#portionP').dataset.v100) || 0;
    const f100 = base ? base.f100 : Number($('#portionF').dataset.v100) || 0;
    const c100 = base ? base.c100 : Number($('#portionC').dataset.v100) || 0;
    const r = g / 100;
    $('#portionKcal').textContent = fmt(r * k100);
    $('#portionP').textContent = (r * p100).toFixed(1);
    $('#portionF').textContent = (r * f100).toFixed(1);
    $('#portionC').textContent = (r * c100).toFixed(1);
    $('#portionPer100').textContent = `${fmt(k100)} ккал / 100 г`;
  }

  function savePortion() {
    const data = currentPortion();
    if (data.grams <= 0) { toast('Укажите вес порции'); return; }
    if (state.editId) {
      Store.updateEntry(state.dateKey, state.editId, {
        name: data.name, grams: data.grams, kcal100: data.kcal100,
        kcal: data.kcal, p: data.p, f: data.f, c: data.c, meal: data.meal,
      });
      toast('Изменения сохранены');
    } else {
      Store.addEntry(state.dateKey, {
        name: data.name, grams: data.grams, kcal100: data.kcal100,
        kcal: data.kcal, p: data.p, f: data.f, c: data.c, meal: data.meal,
        source: 'manual',
      });
      toast(`+${fmt(data.kcal)} ккал`);
      if ($('#addOverlay').classList.contains('open')) closeOverlay('addOverlay');
    }
    closeOverlay('portionOverlay');
    renderToday();
  }

  /* ---------- Фото ---------- */
  function resetPhoto() {
    state.photo = { file: null, items: [] };
    $('#photoInput').value = '';
    $('#photoCameraInput').value = '';
    $('#dzPreview').hidden = true;
    $('#dzInner').hidden = false;
    $('#photoResults').hidden = true;
    $('#photoRecognizeBtn').hidden = true;
    $('#photoStatus').textContent = '';
    $('#photoStatus').className = 'photo-status muted';
  }

  function onPhotoSelected(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Нужен файл изображения'); return; }
    state.photo.file = file;
    const img = $('#dzPreview');
    img.src = URL.createObjectURL(file);
    img.hidden = false;
    $('#dzInner').hidden = true;
    $('#photoResults').hidden = true;
    $('#photoRecognizeBtn').hidden = false;
    $('#photoStatus').textContent = 'Фото готово — нажмите «Распознать»';
    $('#photoStatus').className = 'photo-status muted';
  }

  async function runRecognition() {
    const s = Store.settings();
    const file = state.photo.file;
    if (!file) { toast('Сначала выберите фото'); return; }
    if (!s.apiKey) {
      $('#photoStatus').innerHTML = `⚠️ Нужен API-ключ Gemini. Откройте <b>Настройки → Распознавание</b>, получите бесплатный ключ на <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a> и вставьте его. Пока можно добавлять еду через поиск.`;
      $('#photoStatus').className = 'photo-status error';
      return;
    }
    const btn = $('#photoRecognizeBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Анализирую фото...';
    $('#photoStatus').textContent = 'Модель определяет продукты и порции…';
    $('#photoStatus').className = 'photo-status muted';
    try {
      const res = await Recognition.recognize(file, s.apiKey);
      if (!res.items.length) {
        $('#photoStatus').textContent = 'На фото не удалось распознать еду. Попробуйте другое фото или добавьте вручную.';
        $('#photoStatus').className = 'photo-status error';
      } else {
        state.photo.items = res.items;
        state.meal = defaultMeal();
        $('#photoMeal').value = state.meal;
        renderPhotoItems();
        $('#photoResults').hidden = false;
        $('#photoRecognizeBtn').hidden = true;
        $('#photoStatus').textContent = res.note ? `📝 ${res.note}` : 'Готово! Проверьте и поправьте результат.';
        $('#photoStatus').className = 'photo-status muted';
      }
    } catch (err) {
      console.error(err);
      let msg = 'Ошибка запроса к API: ' + (err.message || err);
      if (err.code === 'no_key') msg = 'Введите API-ключ в настройках.';
      if (String(err.message).includes('API 400') || String(err.message).includes('API 403')) msg = 'Ключ не принят. Проверьте API-ключ в настройках.';
      $('#photoStatus').textContent = msg;
      $('#photoStatus').className = 'photo-status error';
    } finally {
      btn.disabled = false;
      btn.innerHTML = '🔍 Распознать';
    }
  }

  function confBadge(c) {
    const cls = c >= 0.8 ? 'high' : c >= 0.55 ? 'mid' : 'low';
    const txt = c >= 0.8 ? 'точно' : c >= 0.55 ? 'проверьте' : 'низкая точн.';
    return `<span class="conf ${cls}">${txt} ${Math.round(c * 100)}%</span>`;
  }

  function renderPhotoItems() {
    const box = $('#photoItems');
    box.innerHTML = '';
    state.photo.items.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'pitem';
      row.innerHTML = `
        <div class="pitem-top">
          <input type="text" data-k="name" value="" placeholder="Название" />
          ${confBadge(it.confidence)}
          <button class="pitem-x" title="Убрать">✕</button>
        </div>
        <div class="pitem-grid">
          <label class="field"><span>грамм</span><input type="number" data-k="grams" value="${it.grams}" min="1" max="3000" /></label>
          <label class="field"><span>ккал/100</span><input type="number" data-k="kcal100" value="${Math.round(it.kcal100)}" min="0" max="900" /></label>
          <label class="field"><span>Б, г</span><input type="number" data-k="p" value="${round1(it.p)}" min="0" max="100" step="0.1" /></label>
          <label class="field"><span>Ж, г</span><input type="number" data-k="f" value="${round1(it.f)}" min="0" max="100" step="0.1" /></label>
          <label class="field"><span>У, г</span><input type="number" data-k="c" value="${round1(it.c)}" min="0" max="100" step="0.1" /></label>
        </div>`;
      row.querySelector('[data-k="name"]').value = it.name;
      row.querySelector('.pitem-x').addEventListener('click', () => {
        state.photo.items.splice(i, 1);
        renderPhotoItems();
        if (!state.photo.items.length) {
          $('#photoResults').hidden = true;
          $('#photoRecognizeBtn').hidden = false;
        }
      });
      $$('input', row).forEach((inp) => {
        inp.addEventListener('input', () => {
          const k = inp.dataset.k;
          state.photo.items[i][k] = k === 'name' ? inp.value : Number(inp.value) || 0;
          updatePhotoTotal();
        });
      });
      box.appendChild(row);
    });
    updatePhotoTotal();
  }
  const round1 = (v) => Math.round(Number(v) * 10) / 10;

  function updatePhotoTotal() {
    const total = state.photo.items.reduce((a, it) => a + (it.grams / 100) * it.kcal100, 0);
    $('#photoTotal').textContent = `Итого: ${fmt(total)} ккал`;
  }

  function confirmPhoto() {
    const items = state.photo.items.filter((it) => it.name && it.grams > 0);
    if (!items.length) { toast('Нет продуктов для добавления'); return; }
    const meal = $('#photoMeal').value;
    items.forEach((it) => {
      const r = it.grams / 100;
      Store.addEntry(state.dateKey, {
        name: it.name.trim(), grams: it.grams, kcal100: it.kcal100,
        kcal: r * it.kcal100, p: r * it.p, f: r * it.f, c: r * it.c,
        meal, source: 'photo',
      });
    });
    const total = items.reduce((a, it) => a + (it.grams / 100) * it.kcal100, 0);
    closeOverlay('addOverlay');
    renderToday();
    toast(`Добавлено ${items.length} поз. · ${fmt(total)} ккал`);
    resetPhoto();
  }

  /* ---------- История ---------- */
  function renderHistory() {
    const all = Store.allEntries();
    const keys = Object.keys(all).filter((k) => all[k].length).sort().reverse();

    const avg7 = keys.slice(0, 7).map((k) => Store.totalsFor(k).kcal);
    $('#statAvg').textContent = avg7.length ? fmt(avg7.reduce((a, b) => a + b, 0) / avg7.length) : '—';
    $('#statDays').textContent = keys.length;

    let streak = 0;
    const today = parseKey(Store.dateKey());
    for (let i = 0; i < 400; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const k = Store.dateKey(d);
      if (all[k]?.length) streak++;
      else if (i > 0) break;
    }
    $('#statStreak').textContent = streak;

    // график 7 дней
    const chart = $('#chart7');
    chart.innerHTML = '';
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const k = Store.dateKey(d);
      days.push({ k, d, kcal: Store.totalsFor(k).kcal, today: i === 0 });
    }
    const goal = Store.settings().goal || 2000;
    const max = Math.max(goal * 1.1, ...days.map((x) => x.kcal), 1);
    days.forEach((day) => {
      const col = document.createElement('div');
      col.className = 'chart-col';
      const h = Math.max(3, (day.kcal / max) * 130);
      col.innerHTML = `
        <span class="chart-val">${day.kcal ? fmt(day.kcal) : ''}</span>
        <div class="chart-bar ${day.today ? 'today' : ''} ${day.kcal > goal ? 'over' : ''}" style="height:${h}px"></div>
        <span class="chart-lbl">${ruDate(day.d, { weekday: 'short' }).replace('.', '')}</span>`;
      col.addEventListener('click', () => {
        state.dateKey = day.k;
        showScreen('today');
        renderToday();
      });
      col.style.cursor = 'pointer';
      chart.appendChild(col);
    });
    let goalNote = $('#chartGoalNote');
    if (!goalNote) {
      goalNote = document.createElement('div');
      goalNote.id = 'chartGoalNote';
      goalNote.className = 'chart-goal';
      chart.after(goalNote);
    }
    goalNote.textContent = `Цель: ${fmt(goal)} ккал · красным — превышение`;

    // список дней
    const list = $('#dayList');
    list.innerHTML = '';
    if (!keys.length) {
      list.innerHTML = '<div class="no-results"><b>Пока нет записей</b>Начните с экрана «Сегодня»</div>';
      return;
    }
    keys.slice(0, 60).forEach((k) => {
      const t = Store.totalsFor(k);
      const row = document.createElement('button');
      row.className = 'day-row';
      row.innerHTML = `
        <span class="day-date">${titleForKey(k)} <span class="muted">${k.split('-').reverse().slice(0, 2).join('.')}</span></span>
        <span class="day-items">${t.items} поз.</span>
        <span class="day-kcal ${t.kcal > (Store.settings().goal || 2000) ? 'over' : 'ok'}">${fmt(t.kcal)} ккал</span>`;
      row.addEventListener('click', () => {
        state.dateKey = k;
        showScreen('today');
        renderToday();
      });
      list.appendChild(row);
    });
  }

  /* ---------- Настройки ---------- */
  function renderSettings() {
    const s = Store.settings();
    $('#setGoal').value = s.goal;
    $('#setP').value = s.proteinGoal;
    $('#setF').value = s.fatGoal;
    $('#setC').value = s.carbGoal;
    $('#setSex').value = s.sex;
    $('#setAge').value = s.age;
    $('#setHeight').value = s.height;
    $('#setWeight').value = s.weight;
    $('#setActivity').value = String(s.activity);
    $('#setApiKey').value = s.apiKey;
    $('#setPlan').value = s.plan || 'keep';
  }

  function bindSettings() {
    const bind = (sel, key, num = true) => {
      $(sel).addEventListener('change', (e) => {
        const v = num ? Number(e.target.value) : e.target.value;
        Store.setSetting(key, v);
        renderToday();
      });
    };
    bind('#setGoal', 'goal');
    bind('#setP', 'proteinGoal');
    bind('#setF', 'fatGoal');
    bind('#setC', 'carbGoal');
    bind('#setSex', 'sex', false);
    bind('#setAge', 'age');
    bind('#setHeight', 'height');
    bind('#setWeight', 'weight');
    bind('#setActivity', 'activity');
    bind('#setPlan', 'plan', false);
    $('#setApiKey').addEventListener('change', (e) => {
      Store.setSetting('apiKey', e.target.value.trim());
      $('#keyStatus').textContent = e.target.value.trim() ? 'Ключ сохранён в этом браузере.' : '';
    });

    $('#toggleKeyBtn').addEventListener('click', () => {
      const inp = $('#setApiKey');
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      $('#toggleKeyBtn').textContent = show ? 'Скрыть' : 'Показать';
    });

    $('#testKeyBtn').addEventListener('click', async () => {
      const key = $('#setApiKey').value.trim();
      const st = $('#keyStatus');
      if (!key) { st.textContent = 'Введите ключ.'; return; }
      st.textContent = 'Проверяю…';
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Ответь одним словом: ок' }] }] }),
        });
        if (res.ok) {
          st.textContent = '✅ Ключ работает.';
          Store.setSetting('apiKey', key);
        } else {
          st.textContent = `❌ Ошибка ${res.status}. Проверьте ключ.`;
        }
      } catch {
        st.textContent = '❌ Нет сети / нет доступа к API.';
      }
    });

    $('#calcGoalBtn').addEventListener('click', () => {
      const s = Store.settings();
      const w = Number(s.weight) || 70;
      const h = Number(s.height) || 170;
      const a = Number(s.age) || 30;
      const bmr = s.sex === 'female'
        ? 10 * w + 6.25 * h - 5 * a - 161
        : 10 * w + 6.25 * h - 5 * a + 5;
      let tdee = bmr * (Number(s.activity) || 1.4);
      const plan = $('#setPlan').value;
      if (plan === 'lose') tdee *= 0.85;
      if (plan === 'gain') tdee *= 1.15;
      const goal = Math.round(tdee / 10) * 10;
      Store.setSetting('goal', goal);
      Store.setSetting('plan', plan);
      Store.setSetting('proteinGoal', Math.round((goal * 0.3 / 4) / 5) * 5);
      Store.setSetting('fatGoal', Math.round((goal * 0.27 / 9) / 5) * 5);
      Store.setSetting('carbGoal', Math.round((goal * 0.43 / 4) / 5) * 5);
      renderSettings();
      renderToday();
      toast(`Новая цель: ${fmt(goal)} ккал`);
    });

    $('#exportBtn').addEventListener('click', () => {
      const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `kalometr-${Store.dateKey()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Файл выгружен');
    });

    $('#importFile').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          Store.importJSON(String(reader.result));
          state.foodCache = null;
          applyTheme();
          renderToday(); renderSettings();
          toast('Данные импортированы');
        } catch (err) {
          toast('Ошибка импорта: ' + err.message);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    $('#resetBtn').addEventListener('click', () => {
      if (!confirm('Удалить ВСЕ данные дневника? Это действие необратимо.')) return;
      Store.reset();
      state.foodCache = null;
      applyTheme();
      renderToday(); renderSettings();
      toast('Все данные удалены');
    });
  }

  /* ---------- Тема ---------- */
  function applyTheme() {
    const t = Store.settings().theme || 'dark';
    document.documentElement.setAttribute('data-theme', t);
    $('#themeToggle').textContent = t === 'dark' ? '☀️' : '🌙';
    document.querySelector('meta[name="theme-color"]').setAttribute('content', t === 'dark' ? '#0e1512' : '#16a34a');
  }

  /* ---------- Инициализация ---------- */
  function fillMealSelects() {
    const html = MEALS.map((m) => `<option value="${m.id}">${m.emoji} ${m.label}</option>`).join('');
    $('#portionMeal').innerHTML = html;
    $('#photoMeal').innerHTML = html;
  }

  function renderCatChips() {
    const box = $('#catChips');
    box.innerHTML = '';
    CATEGORIES.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'chip' + (c === state.activeCat ? ' active' : '');
      b.textContent = c;
      b.addEventListener('click', () => {
        state.activeCat = c;
        renderCatChips();
        renderSearch($('#searchInput').value);
      });
      box.appendChild(b);
    });
  }

  function bind() {
    // навигация
    $$('[data-screen]').forEach((b) => b.addEventListener('click', () => showScreen(b.dataset.screen)));
    $('#fabAdd').addEventListener('click', () => openAdd());
    $('#sideAddBtn').addEventListener('click', () => openAdd());
    $('#prevDay').addEventListener('click', () => shiftDay(-1));
    $('#nextDay').addEventListener('click', () => shiftDay(1));

    // закрытие шторок
    $$('[data-close]').forEach((b) => b.addEventListener('click', () => closeOverlay(b.dataset.close)));
    $$('.overlay').forEach((ov) => {
      ov.addEventListener('click', (e) => { if (e.target === ov) closeOverlay(ov.id); });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') $$('.overlay.open').forEach((ov) => closeOverlay(ov.id));
    });

    // табы шторки
    $$('#addTabs .tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

    // поиск
    let searchTimer;
    $('#searchInput').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      const v = e.target.value;
      searchTimer = setTimeout(() => renderSearch(v), 120);
    });
    $('#searchInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = $('#searchResults .result');
        if (first) first.click();
      }
    });

    // порция
    $('#portionGrams').addEventListener('input', recalcPortion);
    $('#portionKcal100').addEventListener('input', recalcPortion);
    $('#portionNameInput').addEventListener('input', () => {
      $('#portionName').textContent = $('#portionNameInput').value || '—';
    });
    $$('.stepper').forEach((b) => b.addEventListener('click', () => {
      const inp = $('#portionGrams');
      inp.value = clamp((Number(inp.value) || 0) + Number(b.dataset.step), 1, 5000);
      recalcPortion();
    }));
    $$('#portionPresets .chip').forEach((b) => b.addEventListener('click', () => {
      $('#portionGrams').value = b.dataset.g;
      recalcPortion();
    }));
    $('#portionSaveBtn').addEventListener('click', savePortion);
    $('#portionDeleteBtn').addEventListener('click', () => {
      if (!state.editId) return;
      if (!confirm('Удалить эту запись?')) return;
      Store.deleteEntry(state.dateKey, state.editId);
      state.editId = null;
      closeOverlay('portionOverlay');
      renderToday();
      toast('Запись удалена');
    });

    // фото
    $('#photoInput').addEventListener('change', (e) => onPhotoSelected(e.target.files[0]));
    $('#photoCameraInput').addEventListener('change', (e) => onPhotoSelected(e.target.files[0]));
    $('#photoRecognizeBtn').addEventListener('click', runRecognition);
    $('#photoConfirmBtn').addEventListener('click', confirmPhoto);
    $('#photoAddMoreBtn').addEventListener('click', () => {
      state.photo.items.push({ name: '', grams: 100, kcal100: 100, p: 5, f: 5, c: 15, confidence: 1 });
      renderPhotoItems();
    });
    const dz = $('#dropzone');
    ['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', (e) => onPhotoSelected(e.dataTransfer.files[0]));

    // тема
    $('#themeToggle').addEventListener('click', () => {
      const next = Store.settings().theme === 'dark' ? 'light' : 'dark';
      Store.setSetting('theme', next);
      applyTheme();
    });

    bindSettings();
  }

  function init() {
    if (init.done) return;
    init.done = true;
    applyTheme();
    fillMealSelects();
    renderCatChips();
    bind();
    renderToday();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
