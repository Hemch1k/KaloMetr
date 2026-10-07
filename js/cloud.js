// Облако: авторизация (e-mail/пароль) и синхронизация дневника.
// Провайдер выбирается автоматически: заполнен SUPABASE_CONFIG → Supabase,
// иначе FIREBASE_CONFIG → Firebase, иначе — облако выключено.
// Данные хранятся в аккаунте пользователя, локально остаётся рабочая копия.
const Cloud = (() => {
  const $ = (s) => document.querySelector(s);
  const SUPA_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
  const FB_VER = '11.10.0';
  const FB_BASE = `https://www.gstatic.com/firebasejs/${FB_VER}`;

  const SQL = `create table public.user_meta (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table public.user_days (
  user_id uuid not null references auth.users on delete cascade,
  day text not null,
  entries jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.user_meta enable row level security;
alter table public.user_days enable row level security;
create policy "own meta" on public.user_meta
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own days" on public.user_days
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);`;

  const SETUP_SUPA = `Чтобы включить облако:
    <ol class="setup-steps">
      <li>Создайте проект: <a href="https://supabase.com/dashboard" target="_blank" rel="noopener">supabase.com/dashboard</a> → <b>New project</b> (регион Europe West, пароль БД сохраните).</li>
      <li>Откройте <b>SQL Editor</b>, вставьте скрипт и нажмите <b>Run</b>:
        <button type="button" class="btn btn-ghost btn-sm" id="copySqlBtn">Скопировать SQL</button>
        <pre class="sql-box"><code id="sqlBox">${SQL}</code></pre></li>
      <li><b>Project Settings → API</b> → <b>Project URL</b> и <b>anon public</b> ключ впишите в <b>js/supabase-config.js</b>.</li>
      <li><b>Authentication → URL Configuration</b> → Site URL и Redirect URLs: <code>https://hemch1k.github.io/KaloMetr/</code>.
        В <b>Authentication → Providers → Email</b> можно выключить <i>Confirm email</i>, чтобы не подтверждать почту.</li>
      <li>Обновите страницу.</li>
    </ol>`;

  const SETUP_FB = `Чтобы включить облако: создайте проект на
    <a href="https://console.firebase.google.com" target="_blank" rel="noopener">console.firebase.google.com</a>,
    добавьте веб-приложение, скопируйте конфиг в <b>js/firebase-config.js</b>,
    включите вход Email/Password в Authentication, создайте Firestore с правилами
    <code>request.auth.uid == userId</code> и добавьте домен <b>hemch1k.github.io</b> в Authorized domains.`;

  const SETUP_NONE = `Чтобы включить облако, выберите провайдер:
    <ol class="setup-steps">
      <li><b>Supabase</b> (рекомендуется): создайте проект, выполните SQL-скрипт ниже, вставьте URL и anon-ключ в <code>js/supabase-config.js</code>.</li>
      <li><b>Firebase</b>: создайте проект, вставьте конфиг в <code>js/firebase-config.js</code>, настройте Authentication и Firestore.</li>
    </ol>
    <button type="button" class="btn btn-ghost btn-sm" id="copySqlBtn">Скопировать SQL</button>
    <pre class="sql-box"><code id="sqlBox">${SQL}</code></pre>`;

  const ERR = {
    'auth/invalid-email': 'Некорректный e-mail',
    'auth/missing-password': 'Введите пароль',
    'auth/missing-email': 'Введите e-mail',
    'auth/weak-password': 'Пароль должен быть не короче 6 символов',
    'auth/email-already-in-use': 'Этот e-mail уже зарегистрирован — войдите',
    'auth/invalid-credential': 'Неверный e-mail или пароль',
    'auth/wrong-password': 'Неверный e-mail или пароль',
    'auth/user-not-found': 'Аккаунт с таким e-mail не найден',
    'auth/too-many-requests': 'Слишком много попыток, попробуйте позже',
    'auth/network-request-failed': 'Нет сети — проверьте подключение',
    'auth/operation-not-allowed': 'Способ входа выключен в Firebase → Authentication → Sign-in method',
    'auth/configuration-not-found': 'Включите вход Email/Password в Firebase (Authentication → Sign-in method)',
    'permission-denied': 'Нет доступа: проверьте правила (см. инструкцию настройки)',
  };

  const SUPA_ERR = [
    [/invalid login credentials/i, 'Неверный e-mail или пароль'],
    [/already registered|already been registered/i, 'Этот e-mail уже зарегистрирован — войдите'],
    [/password should be/i, 'Пароль должен быть не короче 6 символов'],
    [/email not confirmed/i, 'Подтвердите e-mail по письму от Supabase'],
    [/unable to validate email|invalid.*email address/i, 'Некорректный e-mail'],
    [/too many requests|rate limit/i, 'Слишком много попыток, попробуйте позже'],
    [/fetch failed|network|failed to fetch|load failed/i, 'Нет сети — проверьте подключение'],
    [/provider/i, 'Провайдер выключен: включите его в Supabase → Authentication → Providers'],
    [/row-level security|42501|violates/i, 'Нет доступа: выполните SQL-скрипт из инструкции настройки'],
    [/jwt|PGRST301|session/i, 'Сессия истекла — войдите заново'],
    [/redirect.*url|invalid redirect/i, 'Добавьте адрес сайта в Supabase → Authentication → URL Configuration → Redirect URLs'],
  ];

  let mode = 'idle'; // idle | unconfigured | loading | ready | error
  let provider = 'none'; // none | supabase | firebase
  let api = null;
  let user = null;
  let info = '';
  let busy = false;
  let pushTimer = null;

  function ru(e) {
    if (!e) return 'Неизвестная ошибка';
    if (e.code && ERR[e.code]) return ERR[e.code];
    const msg = `${e.message || ''} ${e.code || ''}`;
    for (const [re, text] of SUPA_ERR) if (re.test(msg)) return text;
    return e.message || 'Неизвестная ошибка';
  }

  function sbOk() {
    return typeof SUPABASE_CONFIG === 'object' && !!SUPABASE_CONFIG.url && !!SUPABASE_CONFIG.anonKey;
  }
  function fbOk() {
    return typeof FIREBASE_CONFIG === 'object' && !!FIREBASE_CONFIG.apiKey && !!FIREBASE_CONFIG.projectId;
  }
  function isSignedIn() { return !!user; }
  function fireDataChanged() { document.dispatchEvent(new CustomEvent('cloud-data-changed')); }

  /* ================= Supabase ================= */
  const supa = {
    sb: null,
    async init() {
      const mod = await import(SUPA_CDN);
      const base = String(SUPABASE_CONFIG.url || '').replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
      this.sb = mod.createClient(base, SUPABASE_CONFIG.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      this.sb.auth.onAuthStateChange((event, session) => {
        // внутри колбэка нельзя вызывать auth-методы (дедлок) — откладываем
        setTimeout(() => {
          if (!session || event === 'SIGNED_OUT') onUser(null);
          else onUser(supa.toUser(session.user));
        }, 0);
      });
      const { data } = await this.sb.auth.getSession();
      if (data.session) onUser(supa.toUser(data.session.user));
    },
    toUser(u) {
      const md = u.user_metadata || {};
      return { uid: u.id, email: u.email, name: md.full_name || md.name || '', photo: md.avatar_url || '' };
    },
    async login(email, pass) {
      const { error } = await this.sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
    },
    async register(email, pass) {
      const { data, error } = await this.sb.auth.signUp({ email, password: pass });
      if (error) throw error;
      if (!data.session) info = 'Подтвердите e-mail по письму от Supabase и нажмите «Войти»';
    },
    async logout() {
      const { error } = await this.sb.auth.signOut();
      if (error) throw error;
    },
    async pull() {
      const { data: rows, error } = await this.sb.from('user_days').select('day, entries, updated_at');
      if (error) throw error;
      const days = {};
      (rows || []).forEach((r) => {
        days[r.day] = { entries: Array.isArray(r.entries) ? r.entries : [], updatedAt: Date.parse(r.updated_at) || Date.now() };
      });
      const { data: m, error: e2 } = await this.sb.from('user_meta').select('data, updated_at').maybeSingle();
      if (e2) throw e2;
      const meta = m && m.data && Object.keys(m.data).length
        ? { ...m.data, updatedAt: Date.parse(m.updated_at) || Date.now() }
        : null;
      Store.withSuppress(() => Store.mergeCloud(days, meta));
      fireDataChanged();
    },
    async push(snap) {
      const now = new Date().toISOString();
      for (const key of snap.days.slice().sort()) {
        const { error } = await this.sb.from('user_days').upsert({
          user_id: user.uid, day: key, entries: Store.entriesFor(key), updated_at: now,
        });
        if (error) throw error;
      }
      if (snap.meta) {
        const st = Store.state;
        const { error } = await this.sb.from('user_meta').upsert({
          user_id: user.uid,
          data: {
            settings: st.settings || {},
            customFoods: st.customFoods || [],
            favorites: st.favorites || [],
            offCache: st.offCache || {},
          },
          updated_at: now,
        });
        if (error) throw error;
      }
    },
    async wipe() {
      await this.sb.from('user_days').delete().eq('user_id', user.uid);
      await this.sb.from('user_meta').delete().eq('user_id', user.uid);
    },
  };

  /* ================= Firebase ================= */
  const fb = {
    authMod: null, fsMod: null, auth: null, db: null,
    async init() {
      const appMod = await import(`${FB_BASE}/firebase-app.js`);
      this.authMod = await import(`${FB_BASE}/firebase-auth.js`);
      this.fsMod = await import(`${FB_BASE}/firebase-firestore.js`);
      appMod.initializeApp(FIREBASE_CONFIG);
      this.auth = this.authMod.getAuth();
      this.db = this.fsMod.getFirestore();
      this.authMod.onAuthStateChanged(this.auth, (u) => {
        onUser(u ? { uid: u.uid, email: u.email, name: u.displayName || '', photo: u.photoURL || '' } : null);
      });
      this.authMod.getRedirectResult(this.auth).catch(() => {});
    },
    async login(email, pass) { await this.authMod.signInWithEmailAndPassword(this.auth, email, pass); },
    async register(email, pass) { await this.authMod.createUserWithEmailAndPassword(this.auth, email, pass); },
    async logout() { await this.authMod.signOut(this.auth); },
    async pull() {
      const daysSnap = await this.fsMod.getDocs(this.fsMod.collection(this.db, 'users', user.uid, 'days'));
      const days = {};
      daysSnap.forEach((d) => { days[d.id] = d.data(); });
      const metaDoc = await this.fsMod.getDoc(this.fsMod.doc(this.db, 'users', user.uid, 'meta'));
      const meta = metaDoc.exists() ? metaDoc.data() : null;
      Store.withSuppress(() => Store.mergeCloud(days, meta));
      fireDataChanged();
    },
    async push(snap) {
      for (const key of snap.days.slice().sort()) {
        await this.fsMod.setDoc(this.fsMod.doc(this.db, 'users', user.uid, 'days', key), {
          entries: Store.entriesFor(key),
          updatedAt: this.fsMod.serverTimestamp(),
        });
      }
      if (snap.meta) {
        const st = Store.state;
        await this.fsMod.setDoc(this.fsMod.doc(this.db, 'users', user.uid, 'meta'), {
          settings: st.settings || {},
          customFoods: st.customFoods || [],
          favorites: st.favorites || [],
          offCache: st.offCache || {},
          updatedAt: this.fsMod.serverTimestamp(),
        });
      }
    },
    async wipe() {
      const snap = await this.fsMod.getDocs(this.fsMod.collection(this.db, 'users', user.uid, 'days'));
      for (const d of snap.docs) await this.fsMod.deleteDoc(d.ref);
      await this.fsMod.deleteDoc(this.fsMod.doc(this.db, 'users', user.uid, 'meta')).catch(() => {});
    },
  };

  /* ================= Инициализация ================= */
  async function init() {
    if (mode !== 'idle') return;
    Store.onChange(() => schedulePush());
    provider = sbOk() ? 'supabase' : (fbOk() ? 'firebase' : 'none');
    renderSetup();
    if (provider === 'none') { mode = 'unconfigured'; render(); return; }
    mode = 'loading';
    render();
    try {
      api = provider === 'supabase' ? supa : fb;
      await api.init();
      mode = 'ready';
    } catch (e) {
      console.warn('Cloud init error', e);
      api = null;
      mode = 'error';
      info = `Не удалось загрузить ${provider === 'supabase' ? 'Supabase' : 'Firebase'} SDK — проверьте интернет`;
    }
    render();
  }

  async function onUser(u) {
    const was = user && user.uid;
    const now = u && u.uid;
    user = u;
    if (u && was !== now) {
      info = 'Загружаю данные из облака…';
      render();
      try {
        await pull();
        await push();
        info = 'Данные в облаке ✓';
      } catch (e) {
        console.warn(e);
        info = 'Синхронизация: ' + ru(e);
      }
      fireDataChanged();
    } else if (!u) {
      info = '';
    }
    render();
  }

  /* ================= Синхронизация ================= */
  async function pull() {
    if (!user || !api) return;
    await api.pull();
  }

  async function push() {
    if (!user || busy || !api) return;
    const snap = Store.dirtySnapshot();
    if (!snap.days.length && !snap.meta) {
      info = 'Данные в облаке ✓';
      render();
      return;
    }
    busy = true;
    info = `Отправляю в облако (${snap.days.length} дн.)…`;
    render();
    try {
      await api.push(snap);
      Store.clearDirty(snap);
      info = 'Данные в облаке ✓';
    } catch (e) {
      console.warn('push error', e);
      info = 'Не удалось залить: ' + ru(e) + ' (попробую позже)';
      const fatal = e && (e.code === 'permission-denied' || /row-level security|42501/i.test(String(e.message || '')));
      if (!fatal) setTimeout(() => schedulePush(true), 20000);
    } finally {
      busy = false;
      render();
    }
  }

  function schedulePush(immediate) {
    clearTimeout(pushTimer);
    if (!user) return;
    pushTimer = setTimeout(push, immediate ? 0 : 1500);
  }

  /* ================= Действия пользователя ================= */
  function val(sel) { return ($(sel) ? $(sel).value : '').trim(); }

  async function login() {
    await act(async () => { await api.login(val('#authEmail'), val('#authPass')); });
  }

  async function register() {
    await act(async () => {
      const email = val('#authEmail');
      const pass = val('#authPass');
      if (!email) throw { code: 'auth/missing-email' };
      if (pass.length < 6) throw { code: 'auth/weak-password' };
      await api.register(email, pass);
    });
  }

  async function logout() {
    try {
      await api.logout();
      info = '';
    } catch (e) {
      info = ru(e);
    }
    render();
  }

  async function act(fn) {
    if (busy || !api || mode !== 'ready') return;
    busy = true;
    info = 'Подождите…';
    render();
    try {
      await fn();
    } catch (e) {
      info = ru(e);
    } finally {
      busy = false;
      render();
    }
  }

  async function wipe() {
    if (!user || !api) return;
    try {
      await api.wipe();
    } catch (e) {
      console.warn('wipe error', e);
    }
  }

  /* ================= UI ================= */
  function renderSetup() {
    const box = $('#accountSetup');
    if (!box) return;
    box.innerHTML = provider === 'supabase' ? SETUP_SUPA
      : provider === 'firebase' ? SETUP_FB
        : SETUP_NONE;
    const btn = $('#copySqlBtn');
    if (btn) btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(SQL);
        btn.textContent = '✓ Скопировано';
        setTimeout(() => { btn.textContent = 'Скопировать SQL'; }, 1500);
      } catch (e) {
        info = 'Скопируйте вручную из блока ниже';
        render();
      }
    });
  }

  function render() {
    const guest = $('#accountGuest');
    const card = $('#accountUser');
    if (!guest || !card) return;

    const ready = mode === 'ready';
    $('#accountSetup').hidden = mode !== 'unconfigured' && mode !== 'error';
    guest.hidden = ready && !!user;
    card.hidden = !(ready && user);

    const status = $('#authStatus');
    if (mode === 'unconfigured') status.textContent = 'Облако не настроено: заполните js/supabase-config.js (Supabase) или js/firebase-config.js (Firebase)';
    else if (mode === 'loading') status.textContent = `Загружаю ${provider === 'supabase' ? 'Supabase' : 'Firebase'}…`;
    else if (mode === 'error') status.textContent = info || 'Ошибка инициализации';
    else status.textContent = info;
    status.className = 'hint' + (mode === 'unconfigured' || mode === 'error' ? ' hint-warn' : '');

    if (ready && user) {
      const name = user.name || (user.email || '').split('@')[0] || 'Пользователь';
      $('#accName').textContent = name;
      $('#accEmail').textContent = user.email || '';
      const av = $('#accAvatar');
      if (user.photo) { av.src = user.photo; av.hidden = false; } else { av.hidden = true; }
      const s = Store.state.sync || {};
      const pending = Object.keys(s.days || {}).length + (s.meta ? 1 : 0);
      const last = s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
      $('#accSyncStatus').textContent =
        (pending ? `Ожидают отправки: ${pending} изм. · ` : 'Всё синхронизировано ✓ · ') + `последняя синхр.: ${last}`;
      $('#accPending').hidden = !pending;
    }
    const disabled = !ready;
    ['#authLoginBtn', '#authRegisterBtn'].forEach((s) => { if ($(s)) $(s).disabled = disabled; });
  }

  function bind() {
    ['#authLoginBtn', '#authRegisterBtn'].forEach((sel) => {
      const el = $(sel);
      if (el) el.addEventListener('click', () => {
        if (sel.includes('Login')) login();
        else register();
      });
    });
    const pass = $('#authPass');
    if (pass) pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    const out = $('#authLogoutBtn');
    if (out) out.addEventListener('click', logout);
    const syncBtn = $('#accSyncBtn');
    if (syncBtn) syncBtn.addEventListener('click', async () => {
      info = 'Обновляю…';
      render();
      try { await pull(); await push(); info = 'Данные в облаке ✓'; }
      catch (e) { info = ru(e); }
      fireDataChanged();
      render();
    });
  }

  document.addEventListener('DOMContentLoaded', () => { bind(); init(); });

  return { isSignedIn, wipe, schedulePush, init, get provider() { return provider; } };
})();
