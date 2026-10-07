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
    onboardingDone: false,
  });

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const parsed = JSON.parse(raw);
      const d = defaults();
      return {
        ...d,
        ...parsed,
        settings: { ...d.settings, ...(parsed.settings || {}) },
      };
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
  }

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
    setSetting(k, v) { state.settings[k] = v; save(); },

    entriesFor(key) { return state.entries[key] || []; },
    allEntries() { return state.entries; },

    addEntry(key, entry) {
      if (!state.entries[key]) state.entries[key] = [];
      const e = { id: uid(), time: Date.now(), source: 'manual', ...entry };
      state.entries[key].push(e);
      save();
      return e;
    },
    updateEntry(key, id, patch) {
      const list = state.entries[key] || [];
      const e = list.find((x) => x.id === id);
      if (e) Object.assign(e, patch);
      save();
      return e;
    },
    deleteEntry(key, id) {
      const list = state.entries[key] || [];
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) list.splice(i, 1);
      if (!list.length) delete state.entries[key];
      save();
    },

    customFoods: () => state.customFoods,
    addCustomFood(food) {
      const f = { id: uid(), ...food, custom: true };
      state.customFoods.unshift(f);
      save();
      return f;
    },
    removeCustomFood(id) {
      state.customFoods = state.customFoods.filter((f) => f.id !== id);
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
      save();
    },
  };
})();
