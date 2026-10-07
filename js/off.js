// Поиск продуктов в открытой базе Open Food Facts (бесплатно, без ключа, CORS *).
// Русские запросы дублируются транслитерацией/переводом, сбои 5xx повторяются.
// Документация: https://world.openfoodfacts.org/data
const OpenFood = (() => {
  const BASE = 'https://world.openfoodfacts.org';
  const FIELDS = 'code,product_name,product_name_ru,product_name_en,brands,nutriments,image_small_url,quantity';

  // Частые продукты: русское слово → английский запрос для OFF
  const DICT = {
    'банан': 'banana', 'бананы': 'bananas', 'яблоко': 'apple', 'яблоки': 'apples', 'груша': 'pear',
    'апельсин': 'orange', 'лимон': 'lemon', 'клубника': 'strawberry', 'земляника': 'strawberry',
    'малина': 'raspberry', 'вишня': 'cherry', 'черника': 'blueberry', 'виноград': 'grapes',
    'арбуз': 'watermelon', 'дыня': 'melon', 'персик': 'peach', 'слива': 'plum', 'изюм': 'raisins',
    'финики': 'dates', 'курага': 'dried apricot', 'творог': 'cottage cheese', 'творожок': 'curd snack',
    'кефир': 'kefir', 'молоко': 'milk', 'сметана': 'sour cream', 'йогурт': 'yogurt', 'сыр': 'cheese',
    'масло': 'butter', 'сливки': 'cream', 'ряженка': 'ryazhenka', 'сырники': 'curd pancakes',
    'курица': 'chicken', 'куриное': 'chicken', 'куриная': 'chicken', 'грудка': 'breast', 'филе': 'fillet',
    'индейка': 'turkey', 'говядина': 'beef', 'свинина': 'pork', 'баранина': 'lamb',
    'лосось': 'salmon', 'сёмга': 'salmon', 'тунец': 'tuna', 'скумбрия': 'mackerel',
    'яйцо': 'egg', 'яйца': 'eggs', 'колбаса': 'sausage', 'сосиски': 'sausages',
    'рис': 'rice', 'гречка': 'buckwheat', 'гречневая': 'buckwheat',
    'овсянка': 'oatmeal', 'хлопья': 'flakes', 'пшено': 'millet',
    'макароны': 'pasta', 'паста': 'pasta', 'спагетти': 'spaghetti', 'хлеб': 'bread',
    'батон': 'bread', 'булка': 'bun', 'картофель': 'potato', 'картошка': 'potato',
    'помидор': 'tomato', 'огурец': 'cucumber', 'капуста': 'cabbage', 'морковь': 'carrot',
    'лук': 'onion', 'чеснок': 'garlic', 'свёкла': 'beetroot', 'свекла': 'beetroot',
    'перец': 'pepper', 'салат': 'salad', 'зелень': 'greens', 'авокадо': 'avocado',
    'сахар': 'sugar', 'соль': 'salt', 'мёд': 'honey', 'мед': 'honey', 'варенье': 'jam',
    'джем': 'jam', 'шоколад': 'chocolate', 'печенье': 'cookies', 'торт': 'cake',
    'пончик': 'donut', 'мороженое': 'ice cream', 'вафли': 'waffles',
    'орехи': 'nuts', 'миндаль': 'almonds', 'фундук': 'hazelnuts', 'грецкий': 'walnut',
    'арахис': 'peanuts', 'кешью': 'cashews', 'семечки': 'sunflower seeds',
    'подсолнечное': 'sunflower', 'оливковое': 'olive', 'жмых': 'meal',
    'сок': 'juice', 'вода': 'water', 'чай': 'tea', 'кофе': 'coffee', 'компот': 'compote',
    'пиво': 'beer', 'вино': 'wine', 'квас': 'kvass', 'лимонад': 'lemonade',
    'суп': 'soup', 'борщ': 'borscht', 'щи': 'cabbage soup', 'бульон': 'broth',
    'блины': 'pancakes', 'оладьи': 'fritters', 'пельмени': 'dumplings', 'вареники': 'dumplings',
    'пицца': 'pizza', 'бургер': 'burger', 'хот-дог': 'hot dog',
    'каша': 'porridge', 'нут': 'chickpeas', 'фасоль': 'beans', 'чечевица': 'lentils',
    'горох': 'peas', 'кукуруза': 'corn', 'томатный': 'tomato', 'соус': 'sauce',
    'майонез': 'mayonnaise', 'горчица': 'mustard', 'уксус': 'vinegar',
    'протеин': 'protein', 'батончик': 'bar', 'газировка': 'soda',
  };

  const TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c',
    'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
  };

  function num(v) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  function isCyr(s) { return /[\u0400-\u04FF]/.test(s); }

  function toLatin(q) {
    return q.split(/\s+/).map((w) => {
      const low = w.toLowerCase();
      if (DICT[low]) return DICT[low];
      if (!isCyr(low)) return w;
      let out = '';
      for (const ch of low) out += TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch;
      return out;
    }).join(' ');
  }

  // Варианты запроса: оригинал, и если он русский — английский перевод/транслит
  function variants(q) {
    const out = [];
    const push = (v) => {
      const t = String(v || '').trim();
      if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    };
    push(q);
    if (isCyr(q)) push(toLatin(q));
    return out;
  }

  function normalize(p) {
    if (!p || !p.code) return null;
    const n = p.nutriments || {};
    let kcal = num(n['energy-kcal_100g']);
    if (kcal === null && num(n['energy_100g']) !== null) kcal = Math.round(num(n['energy_100g']) / 4.184);
    const name = String(p.product_name_ru || p.product_name || p.product_name_en || '').trim();
    if (!name || kcal === null || kcal <= 0 || kcal > 900) return null;
    return {
      id: 'off_' + p.code,
      n: name.slice(0, 90),
      k: Math.round(kcal),
      p: Math.round((num(n['proteins_100g']) || 0) * 10) / 10,
      f: Math.round((num(n['fat_100g']) || 0) * 10) / 10,
      c: Math.round((num(n['carbohydrates_100g']) || 0) * 10) / 10,
      cat: 'Из интернета',
      brand: String(p.brands || '').split(',')[0].trim().slice(0, 40),
      img: p.image_small_url || '',
      from: 'off',
    };
  }

  // Ранжирование: точное совпадение названия выше, чем случайное упоминание
  function scoreName(name, qs) {
    const n = String(name || '').toLowerCase();
    let best = 0;
    for (const q of qs) {
      const ql = q.toLowerCase();
      if (n.startsWith(ql)) best = Math.max(best, 300);
      else if (n.includes(ql)) best = Math.max(best, 200);
      else {
        const words = ql.split(/\s+/).filter((w) => w.length > 2);
        if (words.length && words.every((w) => n.includes(w))) best = Math.max(best, 150);
        else if (words.some((w) => n.includes(w))) best = Math.max(best, 100);
      }
    }
    return best;
  }

  // Запрос с повторами при 429/5xx и сетевых сбоях
  async function fetchJson(url, timeout = 7000) {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
        if (!res.ok) {
          const err = new Error('HTTP ' + res.status);
          err.http = res.status;
          throw err;
        }
        return await res.json();
      } catch (e) {
        lastErr = e;
        const http = e.http;
        const retriable = http === undefined || http === 429 || http >= 500;
        if (!retriable || attempt === 2) throw lastErr;
        await new Promise((r) => setTimeout(r, 350 + attempt * 700));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  async function search(q, { page = 1, pageSize = 30, timeout = 7000 } = {}) {
    const vs = variants(q);
    const seen = new Set();
    const out = [];
    let failed = 0;

    for (const v of vs) {
      const url = `${BASE}/cgi/search.pl?search_terms=${encodeURIComponent(v)}&search_simple=1` +
        `&action=process&json=1&page=${page}&page_size=${pageSize}&fields=${FIELDS}`;
      try {
        const data = await fetchJson(url, timeout);
        const list = Array.isArray(data.products) ? data.products : [];
        for (const p of list) {
          const f = normalize(p);
          if (!f || seen.has(f.id)) continue;
          seen.add(f.id);
          out.push(f);
        }
        if (out.length >= 10) break; // достаточно — второй вариант не нужен
      } catch (e) {
        failed++;
        if (failed >= vs.length) throw e; // все варианты запроса упали
      }
    }
    const ranked = out.map((f, i) => ({ f, s: scoreName(f.n, vs), i }));
    ranked.sort((a, b) => (b.s - a.s) || (a.i - b.i));
    return ranked.slice(0, pageSize).map((x) => x.f);
  }

  return { search, variants };
})();
