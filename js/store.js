// Хранилище состояния (localStorage)
const Store = (() => {
  const KEY = 'calometr_v1';

  const defaults = () => ({
    settings: {
      goal: 2000,
      proteinGoal: 120,
      fatGoal: 70,
      carbGoal: 250,
      apiKey: '',
      theme: 'dark',
      autoGoal: false,
      weight: 70,
      height: 170,
      age: 30,
      sex: 'male',
      activity: 1.4,
    },
    entries: {}, // { '2026-10-07': [entry, ...] }
    customFoods: [],
    offCache: {}, // продуктов, найденных в Open Food Facts, по id
    favorites: [],
    sync: { days: {}, meta: false, lastSyncAt: null }, // несинхронизированные изменения
    onboardingDone: false,
  });

  let state = load();
  let changeCb = null;
  let suppressNotify = false;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const parsed = JSON.parse(raw);
      const d = defaults();
      const merged = {
        ...d,
        ...parsed,
        settings: { ...d.settings, ...(parsed.settings || {}) },
        sync: { ...d.sync, ...(parsed.sync || {}) },
      };
      merged.sync.days = merged.sync.days || {};
      return merged;
    } catch (e) {
      console.warn('Ошибка чтения данных', e);
      return defaults();
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Ошибка записи данных', e);
    }
    if (changeCb && !suppressNotify) changeCb();
  }

  function markDayDirty(key) { state.sync.days[key] = true; }
  function markMetaDirty() { state.sync.meta = true; }

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function dateKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  return {
    get state() { return state; },
    save,
    uid,
    dateKey,
    reset() { state = defaults(); save(); },

    settings: () => state.settings,
    setSetting(k, v) { state.settings[k] = v; markMetaDirty(); save(); },

    entriesFor(key) { return state.entries[key] || []; },
    allEntries() { return state.entries; },

    addEntry(key, entry) {
      if (!state.entries[key]) state.entries[key] = [];
      const e = { id: uid(), time: Date.now(), source: 'manual', ...entry };
      state.entries[key].push(e);
      markDayDirty(key);
      save();
      return e;
    },
    updateEntry(key, id, patch) {
      const list = state.entries[key] || [];
      const e = list.find((x) => x.id === id);
      if (e) {
        Object.assign(e, patch, { updatedAt: Date.now() });
        markDayDirty(key);
      }
      save();
      return e;
    },
    deleteEntry(key, id) {
      const list = state.entries[key] || [];
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) list.splice(i, 1);
      if (!list.length) delete state.entries[key];
      if (i >= 0) markDayDirty(key);
      save();
    },

    customFoods: () => state.customFoods,
    addCustomFood(food) {
      const f = { id: uid(), ...food, custom: true };
      state.customFoods.unshift(f);
      markMetaDirty();
      save();
      return f;
    },
    removeCustomFood(id) {
      state.customFoods = state.customFoods.filter((f) => f.id !== id);
      markMetaDirty();
      save();
    },

    favorites: () => state.favorites || [],

    cacheFood(food) {
      if (!food || !food.id || food.from !== 'off') return;
      if (!state.offCache) state.offCache = {};
      state.offCache[food.id] = food;
      const keys = Object.keys(state.offCache);
      if (keys.length > 400) {
        keys.slice(0, keys.length - 400).forEach((k) => delete state.offCache[k]);
      }
      markMetaDirty();
      save();
    },
    cachedFood(id) {
      return (state.offCache || {})[id];
    },
    toggleFavorite(id) {
      const favs = state.favorites || [];
      const i = favs.indexOf(id);
      if (i >= 0) favs.splice(i, 1); else favs.unshift(id);
      state.favorites = favs;
      markMetaDirty();
      save();
      return favs.includes(id);
    },

    totalsFor(key) {
      const list = state.entries[key] || [];
      return list.reduce(
        (acc, e) => {
          acc.kcal += e.kcal || 0;
          acc.p += e.p || 0;
          acc.f += e.f || 0;
          acc.c += e.c || 0;
          acc.items += 1;
          return acc;
        },
        { kcal: 0, p: 0, f: 0, c: 0, items: 0 }
      );
    },

    exportJSON() {
      return JSON.stringify(state, null, 2);
    },
    importJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || !parsed.settings) throw new Error('Неверный формат файла');
      state = { ...defaults(), ...parsed, settings: { ...defaults().settings, ...parsed.settings } };
      state.sync = {
        days: Object.fromEntries(Object.keys(state.entries).map((k) => [k, true])),
        meta: true,
        lastSyncAt: null,
      };
      save();
    },

    /* ---- Облачная синхронизация ---- */
    onChange(fn) { changeCb = fn; },
    withSuppress(fn) {
      suppressNotify = true;
      try { fn(); } finally { suppressNotify = false; }
    },
    dirtySnapshot() {
      return { days: Object.keys(state.sync.days || {}), meta: !!state.sync.meta };
    },
    clearDirty(snap) {
      (snap.days || []).forEach((k) => delete state.sync.days[k]);
      if (snap.meta) state.sync.meta = false;
      state.sync.lastSyncAt = Date.now();
      save();
    },

    // Слияние данных облака с локальными (без потерь ни той, ни другой стороны)
    mergeCloud(cloudDays, cloudMeta) {
      const s = state.sync;
      const keys = new Set([
        ...Object.keys(state.entries || {}),
        ...Object.keys(cloudDays || {}),
      ]);

      keys.forEach((key) => {
        const local = (state.entries[key] || []).filter(Boolean);
        const cloud = cloudDays && cloudDays[key];
        if (!cloud) {
          if (local.length) markDayDirty(key); // локальное есть, в облака нет — зальём
          return;
        }
        const cloudEntries = (Array.isArray(cloud.entries) ? cloud.entries : []).filter(Boolean);
        if (!local.length) {
          if (cloudEntries.length) state.entries[key] = cloudEntries;
          return;
        }
        const byId = new Map();
        [...local, ...cloudEntries].forEach((e) => {
          const prev = byId.get(e.id);
          if (!prev) { byId.set(e.id, e); return; }
          const pt = prev.updatedAt || prev.time || 0;
          const et = e.updatedAt || e.time || 0;
          if (et > pt) byId.set(e.id, e); // конфликт — берём более свежую правку
        });
        const merged = [...byId.values()];
        const changed =
          merged.length !== local.length ||
          merged.some((e) => {
            const l = local.find((x) => x.id === e.id);
            return !l || (l.updatedAt || l.time || 0) !== (e.updatedAt || e.time || 0);
          });
        if (changed) {
          state.entries[key] = merged;
          markDayDirty(key);
        }
      });

      if (cloudMeta && typeof cloudMeta === 'object') {
        // коллекции — объединяем всегда
        state.favorites = [...new Set([...(state.favorites || []), ...(cloudMeta.favorites || [])])];
        const customs = new Map();
        [...(state.customFoods || []), ...(cloudMeta.customFoods || [])].forEach((f) => {
          if (f && f.id && !customs.has(f.id)) customs.set(f.id, f);
        });
        state.customFoods = [...customs.values()];
        state.offCache = { ...(cloudMeta.offCache || {}), ...(state.offCache || {}) };
        // настройки: локальные выигрывают, если были правки без синхронизации
        if (!s.meta && cloudMeta.settings) {
          state.settings = { ...state.settings, ...cloudMeta.settings };
        }
        s.meta = true; // объединённое надо залить обратно
      } else {
        s.meta = true; // облако пустое — заливаем локальное
      }
    },
  };
})();
