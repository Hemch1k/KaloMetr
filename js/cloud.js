// Облако: авторизация (e-mail/пароль + Google) и синхронизация дневника в Firestore.
// Данные хранятся в аккаунте пользователя, локально остаётся рабочая копия.
const Cloud = (() => {
  const VER = '11.10.0';
  const BASE = `https://www.gstatic.com/firebasejs/${VER}`;

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
    'auth/popup-blocked': 'Браузер заблокировал окно входа (разрешите всплывающие окна)',
    'auth/popup-closed-by-user': 'Окно входа закрыто',
    'auth/cancelled-popup-request': 'Вход отменён',
    'auth/unauthorized-domain': 'Домен не добавлен в Authorized domains Firebase-консоли',
    'auth/operation-not-allowed': 'Способ входа выключен в Firebase → Authentication → Sign-in method',
    'auth/configuration-not-found': 'Включите нужный способ входа в Firebase (Email/Password, Google)',
    'permission-denied': 'Нет доступа: проверьте правила Firestore (см. инструкцию)',
  };

  const $ = (s) => document.querySelector(s);

  let authMod = null;
  let fsMod = null;
  let auth = null;
  let db = null;
  let mode = 'idle'; // idle | unconfigured | loading | ready | error
  let user = null;
  let info = '';
  let busy = false;
  let pushTimer = null;

  function ru(e) {
    return ERR[e && e.code] || (e && e.message) || 'Неизвестная ошибка';
  }
  function configOk() {
    return typeof FIREBASE_CONFIG === 'object' && !!FIREBASE_CONFIG.apiKey && !!FIREBASE_CONFIG.projectId;
  }
  function isSignedIn() { return !!user; }

  /* ---------- Инициализация ---------- */
  async function init() {
    if (mode !== 'idle') return;
    Store.onChange(() => schedulePush());
    if (typeof FIREBASE_CONFIG === 'undefined' || !configOk()) {
      mode = 'unconfigured';
      render();
      return;
    }
    mode = 'loading';
    render();
    try {
      const appMod = await import(`${BASE}/firebase-app.js`);
      authMod = await import(`${BASE}/firebase-auth.js`);
      fsMod = await import(`${BASE}/firebase-firestore.js`);
      appMod.initializeApp(FIREBASE_CONFIG);
      auth = authMod.getAuth();
      db = fsMod.getFirestore();
      authMod.onAuthStateChanged(auth, onAuthChange);
      authMod.getRedirectResult(auth).catch(() => {});
      mode = 'ready';
    } catch (e) {
      console.warn('Firebase init error', e);
      mode = 'error';
      info = 'Не удалось загрузить Firebase SDK — проверьте интернет';
    }
    render();
  }

  async function onAuthChange(u) {
    user = u;
    info = u ? 'Загружаю данные из облака…' : '';
    render();
    if (u) {
      try {
        await pull();
        await push();
        info = 'Данные в облаке ✓';
      } catch (e) {
        console.warn(e);
        info = 'Синхронизация: ' + ru(e);
      }
      fireDataChanged();
    }
    render();
  }

  /* ---------- Синхронизация ---------- */
  async function pull() {
    if (!user) return;
    const daysSnap = await fsMod.getDocs(fsMod.collection(db, 'users', user.uid, 'days'));
    const days = {};
    daysSnap.forEach((d) => { days[d.id] = d.data(); });
    const metaDoc = await fsMod.getDoc(fsMod.doc(db, 'users', user.uid, 'meta'));
    const meta = metaDoc.exists() ? metaDoc.data() : null;
    Store.withSuppress(() => Store.mergeCloud(days, meta));
    fireDataChanged();
  }

  async function push() {
    if (!user || busy) return;
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
      for (const key of snap.days.slice().sort()) {
        await fsMod.setDoc(fsMod.doc(db, 'users', user.uid, 'days', key), {
          entries: Store.entriesFor(key),
          updatedAt: fsMod.serverTimestamp(),
        });
      }
      if (snap.meta) {
        const st = Store.state;
        await fsMod.setDoc(fsMod.doc(db, 'users', user.uid, 'meta'), {
          settings: st.settings || {},
          customFoods: st.customFoods || [],
          favorites: st.favorites || [],
          offCache: st.offCache || {},
          updatedAt: fsMod.serverTimestamp(),
        });
      }
      Store.clearDirty(snap);
      info = 'Данные в облаке ✓';
    } catch (e) {
      console.warn('push error', e);
      info = 'Не удалось залить: ' + ru(e) + ' (попробую позже)';
      if (e && e.code !== 'permission-denied') setTimeout(() => schedulePush(true), 20000);
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

  function fireDataChanged() {
    document.dispatchEvent(new CustomEvent('cloud-data-changed'));
  }

  /* ---------- Действия пользователя ---------- */
  function val(sel) { return ($(sel) ? $(sel).value : '').trim(); }

  async function login() {
    await act(async () => {
      await authMod.signInWithEmailAndPassword(auth, val('#authEmail'), val('#authPass'));
    });
  }

  async function register() {
    await act(async () => {
      const email = val('#authEmail');
      const pass = val('#authPass');
      if (!email) throw { code: 'auth/missing-email' };
      if (pass.length < 6) throw { code: 'auth/weak-password' };
      await authMod.createUserWithEmailAndPassword(auth, email, pass);
    });
  }

  async function google() {
    await act(async () => {
      const provider = new authMod.GoogleAuthProvider();
      try {
        await authMod.signInWithPopup(auth, provider);
      } catch (e) {
        if (['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e.code)) {
          info = 'Открываю страницу входа Google…';
          render();
          await authMod.signInWithRedirect(auth, provider);
          return;
        }
        throw e;
      }
    });
  }

  async function logout() {
    try {
      await authMod.signOut(auth);
      info = '';
    } catch (e) {
      info = ru(e);
    }
    render();
  }

  async function act(fn) {
    if (busy || !authMod) return;
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
    if (!user) return;
    try {
      const snap = await fsMod.getDocs(fsMod.collection(db, 'users', user.uid, 'days'));
      for (const d of snap.docs) await fsMod.deleteDoc(d.ref);
      await fsMod.deleteDoc(fsMod.doc(db, 'users', user.uid, 'meta')).catch(() => {});
    } catch (e) {
      console.warn('wipe error', e);
    }
  }

  /* ---------- UI ---------- */
  function render() {
    const guest = $('#accountGuest');
    const card = $('#accountUser');
    if (!guest || !card) return;

    const configured = mode === 'ready';
    $('#accountSetup').hidden = mode !== 'unconfigured' && mode !== 'error';
    guest.hidden = configured && !!user;
    card.hidden = !(configured && user);

    const status = $('#authStatus');
    if (mode === 'unconfigured') status.textContent = 'Облако не настроено: создайте Firebase-проект и вставьте конфигурацию в js/firebase-config.js';
    else if (mode === 'loading') status.textContent = 'Загружаю Firebase…';
    else if (mode === 'error') status.textContent = info || 'Ошибка инициализации';
    else status.textContent = info;
    status.className = 'hint' + (mode === 'unconfigured' || mode === 'error' ? ' hint-warn' : '');

    if (configured && user) {
      const name = user.displayName || (user.email || '').split('@')[0] || 'Пользователь';
      $('#accName').textContent = name;
      $('#accEmail').textContent = user.email || 'вход через Google';
      const av = $('#accAvatar');
      if (user.photoURL) { av.src = user.photoURL; av.hidden = false; } else { av.hidden = true; }
      const s = Store.state.sync || {};
      const pending = Object.keys(s.days || {}).length + (s.meta ? 1 : 0);
      const last = s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
      $('#accSyncStatus').textContent =
        (pending ? `Ожидают отправки: ${pending} изм. · ` : 'Всё синхронизировано ✓ · ') + `последняя синхр.: ${last}`;
      $('#accPending').hidden = !pending;
    }
    const disabled = !configured;
    ['#authLoginBtn', '#authRegisterBtn', '#authGoogleBtn'].forEach((s) => { if ($(s)) $(s).disabled = disabled; });
  }

  function bind() {
    ['#authLoginBtn', '#authRegisterBtn', '#authGoogleBtn'].forEach((sel) => {
      const el = $(sel);
      if (el) el.addEventListener('click', () => {
        if (sel.includes('Login')) login();
        else if (sel.includes('Register')) register();
        else google();
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

  return { isSignedIn, wipe, schedulePush, init };
})();
