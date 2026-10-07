// Распознавание еды по фото через Google Gemini (vision).
// Ключ API вводится в настройках и хранится локально в браузере.
const Recognition = (() => {
  const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];

  const SYSTEM_PROMPT = `Ты — нутрициолог, который распознаёт еду на фотографиях.
Верни СТРОГО JSON вида:
{"items":[{"name":"Название продукта/блюда (рус.)","grams":150,"kcal_per_100g":165,"protein":31,"fat":3.6,"carbs":0,"confidence":0.92}],"note":"краткое пояснение"}

Правила:
- Определи каждый видимый продукт/блюдо отдельно.
- grams — реалистичная оценка массы порции на фото (целое число).
- kcal_per_100g, protein, fat, carbs — на 100 г, средние значения по составу.
- confidence — уверенность 0..1 (чем меньше уверенность, тем ниже).
- Если фото не содержит еду, верни {"items":[],"note":"На фото не удалось распознать еду"}.
- Никакого текста вне JSON.`;

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function downscale(file, maxDim = 1024, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width: w, height: h } = img;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({ mime: 'image/jpeg', data: dataUrl.split(',')[1] });
      };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  async function callModel(model, apiKey, parts) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`API ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    if (!text) throw new Error('Пустой ответ модели');
    return parseLoose(text);
  }

  function parseLoose(text) {
    try {
      return JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Не удалось разобрать ответ модели');
      return JSON.parse(m[0]);
    }
  }

  async function recognizeParts(parts, apiKey) {
    if (!apiKey) throw Object.assign(new Error('no_key'), { code: 'no_key' });
    let lastErr;
    for (const model of MODELS) {
      try {
        const result = await callModel(model, apiKey, parts);
        return normalize(result);
      } catch (e) {
        lastErr = e;
        if (e.status === 404 || e.status === 400) continue; // модель недоступна — пробуем следующую
        throw e;
      }
    }
    throw lastErr;
  }

  async function recognize(file, apiKey) {
    if (!apiKey) throw Object.assign(new Error('no_key'), { code: 'no_key' });
    const img = await downscale(file);
    return recognizeParts(
      [
        { text: 'Распознай еду на этой фотографии.' },
        { inline_data: { mime_type: img.mime, data: img.data } },
      ],
      apiKey
    );
  }

  function normalize(result) {
    const items = Array.isArray(result?.items) ? result.items : [];
    return {
      note: result?.note || '',
      items: items.map((it) => ({
        name: String(it.name || 'Продукт').slice(0, 80),
        grams: clampNum(it.grams, 1, 3000, 150),
        kcal100: clampNum(it.kcal_per_100g ?? it.kcal100, 0, 900, 150),
        p: clampNum(it.protein ?? it.p, 0, 100, 5),
        f: clampNum(it.fat ?? it.f, 0, 100, 5),
        c: clampNum(it.carbs ?? it.c, 0, 100, 20),
        confidence: clampNum(it.confidence, 0, 1, 0.7),
      })),
    };
  }

  function clampNum(v, min, max, dflt) {
    const n = Number(v);
    if (!isFinite(n)) return dflt;
    return Math.min(max, Math.max(min, n));
  }

  return { recognize, recognizeParts };
})();
