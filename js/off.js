// Поиск продуктов в открытой базе Open Food Facts (бесплатно, без ключа, CORS *).
// Документация: https://world.openfoodfacts.org/data
const OpenFood = (() => {
  const BASE = 'https://world.openfoodfacts.org';
  const FIELDS = 'code,product_name,product_name_ru,brands,nutriments,image_small_url,quantity';

  function num(v) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  function normalize(p) {
    if (!p || !p.code) return null;
    const n = p.nutriments || {};
    let kcal = num(n['energy-kcal_100g']);
    if (kcal === null && num(n['energy_100g']) !== null) kcal = Math.round(num(n['energy_100g']) / 4.184);
    const name = String(p.product_name_ru || p.product_name || '').trim();
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

  async function search(q, { page = 1, pageSize = 24, timeout = 9000 } = {}) {
    const url = `${BASE}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1` +
      `&action=process&json=1&page=${page}&page_size=${pageSize}&fields=${FIELDS}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const list = Array.isArray(data.products) ? data.products : [];
      const seen = new Set();
      const out = [];
      for (const p of list) {
        const f = normalize(p);
        if (!f || seen.has(f.id)) continue;
        seen.add(f.id);
        out.push(f);
        if (out.length >= pageSize) break;
      }
      return out;
    } finally {
      clearTimeout(timer);
    }
  }

  return { search };
})();
