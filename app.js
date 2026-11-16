/* Электронный учебник «Программирование на Python». Общая база и учётная запись — как у isu-trainer. */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const store = {get:(k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } }, set:(k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }};
const C = window.PYC, TESTS = window.PYTESTS, COURSE = 'py';
const TEST_ORDER = ['L1','L2','L3','L4','L5','FT'];
const tGrade = p => p >= 85 ? [5, 'отлично'] : p >= 70 ? [4, 'хорошо'] : p >= 55 ? [3, 'удовлетворительно'] : [2, 'неудовлетворительно'];
const BLOOM = {1:'Запоминание', 2:'Понимание', 3:'Применение'};

/* ---------- запуск Python в браузере (Pyodide) ---------- */
let pyP = null;
function loadPy(){
  if (pyP) return pyP;
  pyP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';
    s.onload = () => loadPyodide().then(res, rej); s.onerror = () => { pyP = null; rej(new Error('Не удалось загрузить Python. Нужен интернет при первом запуске.')); }; document.head.appendChild(s); });
  return pyP;
}
async function runPy(code){
  const p = await loadPy(); let buf = '';
  p.setStdout({batched: s => buf += s + '\n'}); p.setStderr({batched: s => buf += s + '\n'});
  p.globals.set('__code', code);
  try {
    await p.runPythonAsync("import builtins, js\nbuiltins.input = lambda prompt='': (js.prompt(str(prompt)) or '')\nexec(compile(__code, 'program', 'exec'), {'__name__': '__main__'})");
    return {out: buf || '(программа ничего не вывела)', err: false};
  } catch(e){ return {out: buf + String(e.message || e).split('\n').slice(-4).join('\n'), err: true}; }
}
function wireCode(root){
  root.querySelectorAll('.code').forEach(box => {
    const ta = box.querySelector('textarea'), out = box.querySelector('.out'), orig = ta.value;
    ta.rows = Math.min(24, ta.value.split('\n').length + 1);
    box.querySelector('.reset').onclick = () => { ta.value = orig; out.textContent = ''; out.classList.remove('err'); };
    ta.addEventListener('keydown', e => { if (e.key === 'Tab'){ e.preventDefault(); ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end'); } });
    box.querySelector('.run').onclick = async () => { out.classList.remove('err'); out.textContent = 'Загрузка Python…';
      try { const r = await runPy(ta.value); out.classList.toggle('err', r.err); out.textContent = r.out; } catch(e){ out.classList.add('err'); out.textContent = e.message; } };
  });
}

/* ---------- облако: вход, события, сдача ---------- */
const CLOUD = (window.ISU_CLOUD && ISU_CLOUD.url && ISU_CLOUD.key) ? ISU_CLOUD : null;
const SB_URLS = ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js', 'https://unpkg.com/@supabase/supabase-js@2.45.4/dist/umd/supabase.js'];
let SB = null, ME = null, SB_FAIL = false;
const CQ = {get: () => store.get('py-cloud-q', []), set: q => store.set('py-cloud-q', q.slice(-2000))};
const qid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const sessOnce = k => { try { if (sessionStorage.getItem(k)) return false; sessionStorage.setItem(k, '1'); } catch(e){} return true; };
function cloudLib(){
  if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
  return new Promise((res, rej) => { let i = 0; const next = () => { if (i >= SB_URLS.length) return rej(new Error('lib'));
    const s = document.createElement('script'); s.src = SB_URLS[i++]; s.onload = () => window.supabase && window.supabase.createClient ? res(window.supabase) : next(); s.onerror = next; document.head.appendChild(s); }; next(); });
}
async function cloudInit(){
  if (!CLOUD) return;
  $('#acct').hidden = false; acctRender();
  try { const lib = await cloudLib(); SB = lib.createClient(CLOUD.url, CLOUD.key, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}}); }
  catch(e){ SB_FAIL = true; acctRender(); return; }
  SB.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') setTimeout(() => authOpen('newpass'), 50); if (ev === 'SIGNED_OUT'){ ME = null; acctRender(); } });
  const {data} = await SB.auth.getSession();
  if (data && data.session) await cloudLoadMe(data.session.user); else acctRender();
}
async function cloudLoadMe(user){
  const {data, error} = await SB.from('profiles').select('id,fio,grp,role,email').eq('id', user.id).single();
  if (error || !data){ ME = null; acctRender(); return false; }
  ME = data; acctRender(); cloudFlush();
  if (sessOnce('py-login-' + ME.id)) cloudEv('login', null, null, {ua: navigator.userAgent.slice(0, 120), w: innerWidth});
  return true;
}
function cloudEv(kind, ref = null, val = null, data = null){
  if (!CLOUD || !ME) return;
  const q = CQ.get(); q.push({qid:qid(), t:'events', uid:ME.id, row:{kind, ref: ref == null ? null : String(ref), val, data: {...(data || {}), course:COURSE}, at: new Date().toISOString()}}); CQ.set(q); cloudFlushSoon();
}
let cfT = null, cfBusy = false;
const cloudFlushSoon = () => { clearTimeout(cfT); cfT = setTimeout(cloudFlush, 3000); };
async function cloudFlush(){
  if (!SB || !ME || cfBusy) return; cfBusy = true;
  try {
    const ev = CQ.get().filter(x => x.uid === ME.id && x.t === 'events').slice(0, 500);
    if (ev.length){ const {error} = await SB.from('events').insert(ev.map(x => x.row)); if (!error){ const ids = new Set(ev.map(x => x.qid)); CQ.set(CQ.get().filter(x => !ids.has(x.qid))); } }
    for (const s of CQ.get().filter(x => x.uid === ME.id && x.t === 'submissions')){
      const {error} = await SB.from('submissions').insert(s.row); if (!error) CQ.set(CQ.get().filter(x => x.qid !== s.qid));
    }
  } catch(e){}
  cfBusy = false; acctRender();
}
/* время работы: считаются только активные минуты */
let lastAct = Date.now(); const tBuck = {};
['mousemove','keydown','scroll','touchstart','click'].forEach(e => addEventListener(e, () => { lastAct = Date.now(); }, {passive:true, capture:true}));
let curTab = 'home';
const grpOf = id => /^lec/.test(id) ? 'theory' : /^pz/.test(id) ? 'rep' : /^test/.test(id) || id === 'tests' ? 'quiz' : id === 'home' ? 'home' : 'start';
setInterval(() => { if (!ME || document.visibilityState !== 'visible' || Date.now() - lastAct > 120000) return; const g = grpOf(curTab); tBuck[g] = (tBuck[g] || 0) + 15; }, 15000);
function timeFlush(){ Object.keys(tBuck).forEach(g => { if (tBuck[g] > 0){ cloudEv('time', g, tBuck[g]); tBuck[g] = 0; } }); }
setInterval(timeFlush, 120000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden'){ timeFlush(); cloudFlush(); } });
addEventListener('online', () => cloudFlush());

/* ---------- панель учётной записи и окно входа ---------- */
const shortFio = f => { const p = String(f).trim().split(/\s+/); return p[0] + (p[1] ? ' ' + p[1][0] + '.' : '') + (p[2] ? p[2][0] + '.' : ''); };
function acctRender(){
  const el = $('#acct'); if (!el || !CLOUD) return; const qn = CQ.get().filter(x => ME && x.uid === ME.id).length;
  if (SB_FAIL){ el.innerHTML = '<span class="small">Сервер недоступен — работа сохраняется на этом устройстве</span>'; return; }
  if (!SB){ el.innerHTML = '<span class="small">Подключение…</span>'; return; }
  if (!ME){ el.innerHTML = '<button class="btn" data-auth="login">Войти</button><button class="btn" data-auth="signup">Регистрация</button>'; return; }
  el.innerHTML = `<span><b>${esc(shortFio(ME.fio))}</b> · ${esc(ME.grp || '')}</span>${qn ? `<span class="small">не отправлено: ${qn}</span>` : ''}`
    + (ME.role === 'teacher' ? '<a class="btn" href="../isu-trainer/teacher.html">Кабинет преподавателя</a>' : '')
    + '<button class="btn" data-auth="mine">Мои работы</button><button class="btn" data-auth="logout">Выйти</button>';
}
let authAfter = null;
function authOpen(mode, note, after){
  authAfter = after || null; const dl = $('#auth-dlg');
  const F = (id, label, type, ac) => `<label for="${id}">${label}</label><input id="${id}" type="${type}" autocomplete="${ac}">`;
  let h = '';
  if (mode === 'login') h = `<h2>Вход</h2>${note ? `<p class="small">${esc(note)}</p>` : ''}${F('au-email','Электронная почта','email','email')}${F('au-pass','Пароль','password','current-password')}
    <div class="btns"><button class="btn pri" data-au="do-login">Войти</button><button class="linkbtn" data-auth="signup">Регистрация</button><button class="linkbtn" data-auth="reset">Забыли пароль?</button></div>`;
  if (mode === 'signup') h = `<h2>Регистрация слушателя</h2><p class="small">Код группы выдаёт преподаватель. Если вы уже зарегистрированы в другом учебнике, используйте тот же вход. ФИО пишите полностью.</p>
    ${F('au-fio','Фамилия Имя Отчество','text','name')}${F('au-code','Код группы','text','off')}<p class="small" id="au-grp"></p>${F('au-email','Электронная почта','email','email')}${F('au-pass','Пароль (не меньше 6 знаков)','password','new-password')}
    <div class="btns"><button class="btn pri" data-au="do-signup">Зарегистрироваться</button><button class="linkbtn" data-auth="login">У меня уже есть вход</button></div>`;
  if (mode === 'reset') h = `<h2>Восстановление пароля</h2><p class="small">Пришлём на почту ссылку. Откройте её на этом же устройстве и задайте новый пароль.</p>${F('au-email','Электронная почта','email','email')}
    <div class="btns"><button class="btn pri" data-au="do-reset">Отправить ссылку</button><button class="linkbtn" data-auth="login">Назад</button></div>`;
  if (mode === 'newpass') h = `<h2>Новый пароль</h2>${F('au-pass','Новый пароль (не меньше 6 знаков)','password','new-password')}<div class="btns"><button class="btn pri" data-au="do-newpass">Сохранить</button></div>`;
  if (mode === 'mine') h = `<h2>Мои работы</h2><div id="au-mine"><p class="small">Загрузка…</p></div>`;
  dl.innerHTML = `<form method="dialog" class="au-x"><button class="linkbtn" aria-label="Закрыть">✕</button></form>${h}<p class="au-msg" id="au-msg" role="status"></p>`;
  dl.classList.toggle('wide', mode === 'mine');
  if (!dl.open) dl.showModal();
  const f = dl.querySelector('input'); if (f) f.focus();
  if (mode === 'mine') loadMine();
  const code = $('#au-code'); if (code) code.addEventListener('change', async () => { const r = await SB.rpc('check_group_code', {p_code: code.value.trim()}); $('#au-grp').innerHTML = r.data ? `Группа: <b>${esc(r.data)}</b>` : '<span class="cl-err">Код не найден</span>'; });
}
const auMsg = (t, ok) => { const m = $('#au-msg'); m.className = 'au-msg ' + (ok ? 'cl-okt' : 'cl-err'); m.textContent = t; };
const AUERR = e => { const m = (e && e.message) || ''; if (/Invalid login/i.test(m)) return 'Неверная почта или пароль.'; if (/not confirmed/i.test(m)) return 'Почта не подтверждена: откройте ссылку из письма.';
  if (/already registered/i.test(m)) return 'Эта почта уже зарегистрирована — войдите.'; if (/at least 6/i.test(m)) return 'Пароль слишком короткий: нужно не меньше 6 знаков.';
  if (/Database error/i.test(m)) return 'Регистрация отклонена: проверьте код группы и ФИО.'; if (/valid email|invalid format/i.test(m)) return 'Проверьте адрес почты.';
  if (/rate limit|too many/i.test(m)) return 'Слишком много попыток. Подождите минуту.'; return m || 'Нет связи с сервером.'; };
async function loadMine(){
  let {data, error} = await SB.from('submissions').select('id,kind,ref,title,score,grade,teacher_grade,teacher_comment,created_at,course:data->>course').order('created_at', {ascending:false}).limit(300);
  const box = $('#au-mine'); if (!box) return;
  if (error){ box.innerHTML = `<p class="cl-err">${esc(AUERR(error))}</p>`; return; }
  data = data.filter(s => s.course === COURSE);
  if (!data.length){ box.innerHTML = '<p class="small">Пока ничего не сдано.</p>'; return; }
  box.innerHTML = `<div class="tw"><table><thead><tr><th>Дата</th><th>Работа</th><th>Результат</th><th>Оценка преподавателя</th></tr></thead><tbody>${data.map(s => `<tr><td class="small">${new Date(s.created_at).toLocaleString('ru-RU', {dateStyle:'short', timeStyle:'short'})}</td><td>${s.kind === 'test' ? 'Тест: ' : 'Отчёт: '}${esc(s.title || s.ref)}</td><td>${s.kind === 'test' ? s.score + ' %' : 'заполнено ' + s.score + ' %'}</td><td>${s.teacher_grade ? '<b>' + s.teacher_grade + '</b>' : '<span class="small">не проверено</span>'}${s.teacher_comment ? `<br><span class="small">${esc(s.teacher_comment)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
document.addEventListener('click', async e => {
  const a = e.target.closest('[data-auth]'); if (a){ e.preventDefault(); const m = a.dataset.auth;
    if (m === 'logout'){ timeFlush(); await cloudFlush(); await SB.auth.signOut(); ME = null; acctRender(); return; }
    authOpen(m); return; }
  const b = e.target.closest('[data-au]'); if (!b) return; e.preventDefault(); const v = id => ($('#' + id) || {}).value || '';
  b.disabled = true;
  try {
    if (b.dataset.au === 'do-login'){
      const {data, error} = await SB.auth.signInWithPassword({email: v('au-email').trim(), password: v('au-pass')});
      if (error) auMsg(AUERR(error)); else if (await cloudLoadMe(data.user)){ $('#auth-dlg').close(); const f = authAfter; authAfter = null; if (f) f(); } else auMsg('Профиль не найден. Обратитесь к преподавателю.');
    }
    if (b.dataset.au === 'do-signup'){
      const fio = v('au-fio').trim().replace(/\s+/g, ' '), code = v('au-code').trim();
      if (fio.split(' ').length < 2) auMsg('Укажите фамилию и имя полностью.');
      else { const g = await SB.rpc('check_group_code', {p_code: code});
        if (!g.data) auMsg('Неверный код группы. Уточните его у преподавателя.');
        else { const {data, error} = await SB.auth.signUp({email: v('au-email').trim(), password: v('au-pass'), options:{data:{fio, code}, emailRedirectTo: location.href.split('#')[0]}});
          if (error) auMsg(AUERR(error));
          else if (data.session){ await cloudLoadMe(data.user); $('#auth-dlg').close(); const f = authAfter; authAfter = null; if (f) f(); }
          else auMsg('Готово! На почту отправлено письмо: откройте ссылку, чтобы подтвердить адрес, затем войдите.', true); } }
    }
    if (b.dataset.au === 'do-reset'){ const {error} = await SB.auth.resetPasswordForEmail(v('au-email').trim(), {redirectTo: location.href.split('#')[0]}); if (error) auMsg(AUERR(error)); else auMsg('Ссылка отправлена. Проверьте почту (и папку «Спам»).', true); }
    if (b.dataset.au === 'do-newpass'){ const {error} = await SB.auth.updateUser({password: v('au-pass')}); if (error) auMsg(AUERR(error)); else { auMsg('Пароль изменён.', true); const {data} = await SB.auth.getSession(); if (data.session) await cloudLoadMe(data.session.user); } }
  } catch(err){ auMsg(AUERR(err)); }
  b.disabled = false;
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest && e.target.closest('#auth-dlg input')){ const b = $('#auth-dlg [data-au]'); if (b){ e.preventDefault(); b.click(); } } });

/* ---------- страницы ---------- */
const TABS = [['home','О курсе'],['lec1','Лекции'],['pz1','Практика'],['tests','Тесты'],['exam','Зачёт'],['refs','Литература']];
const tabOf = id => /^lec/.test(id) ? 'lec1' : /^pz/.test(id) ? 'pz1' : /^test/.test(id) || id === 'tests' ? 'tests' : id === 'plan' || id === 'passport' ? 'home' : id;
function renderTabs(id){ $('#tabs').innerHTML = TABS.map(([k, n]) => `<button class="tab" role="tab" data-go="${k}" aria-selected="${tabOf(id) === k}">${n}</button>`).join(''); }
const nav2 = (p, n) => `<div class="nav2">${p ? `<button class="btn" data-go="${p[0]}">← ${esc(p[1])}</button>` : '<span></span>'}${n ? `<button class="btn" data-go="${n[0]}">${esc(n[1])} →</button>` : '<span></span>'}</div>`;
const best = id => { const a = store.get('py-t-' + id, []); return a.length ? Math.max(...a.map(x => x.pct)) : null; };
function pgCover(){
  return `<section class="cover"><div class="cv-main">
    <p class="cv-org">Национальная академия наук Кыргызской Республики<br>Международный университет имени К. Ш. Токтомаматова</p>
    <p class="cv-kick">Электронный учебник</p>
    <h1 class="cv-title">Программирование</h1>
    <p class="cv-sub">Язык Python для переподготовки учителей информатики Кыргызской Республики</p>
    <ul class="cv-stats"><li><b>5</b><span>лекций</span></li><li><b>2</b><span>практических занятия</span></li><li><b>6</b><span>тестов</span></li><li><b>1</b><span>зачёт</span></li></ul>
    <p class="cv-act"><button class="btn cv-go" data-go="lec1">Начать с лекции 1 →</button> <button class="btn cv-alt" data-go="passport">Паспорт курса</button></p>
    <p class="cv-au">Д. Э. Канетова<br><span>к.ф.-м.н., доцент</span></p>
  </div><div class="cv-art" aria-hidden="true"><div class="cv-win"><div class="cv-dots"><i></i><i></i><i></i></div>
<pre><span class="k">for</span> lesson <span class="k">in</span> course:
    learn(lesson)
    practice()
<span class="k">if</span> test_passed:
    <span class="f">print</span>(<span class="s">"зачёт сдан"</span>)</pre></div>
    <svg class="cv-ring" viewBox="0 0 200 200"><circle cx="100" cy="100" r="86"/><circle cx="100" cy="100" r="56"/></svg></div>
    <p class="cv-year">2026</p></section>`;
}
function pgHome(){
  const lec = C.lectures.map(l => `<button class="card" data-go="lec${l.n}"><b>Лекция ${l.n}. ${esc(l.title)}</b><small>тест: ${best('L' + l.n) == null ? 'не пройден' : best('L' + l.n) + ' %'}</small></button>`).join('');
  const pz = C.pz.map(p => `<button class="card" data-go="pz${p.n}"><b>Практическое занятие ${p.n}</b><small>${esc(p.title)}</small></button>`).join('');
  return pgCover() + `<div class="panel"><p class="lead">Электронный учебник для переподготовки учителей информатики Кыргызской Республики: 5 лекций, 2 практических занятия и зачёт. Примеры кода можно запускать и менять прямо на странице, а тесты и отчёты — сдавать преподавателю.</p>
    <p class="small">Первый запуск Python занимает несколько секунд и требует интернета. Войти можно той же учётной записью, что и в других учебниках; код группы выдаёт преподаватель.</p></div>
    <h2>Лекции</h2><div class="cards">${lec}</div><h2>Практика, тесты и зачёт</h2><div class="cards">${pz}<button class="card" data-go="tests"><b>Тесты</b><small>5 тестов к лекциям и итоговый</small></button><button class="card" data-go="exam"><b>Зачёт</b><small>порядок, критерии, варианты</small></button></div>
    <h2>О курсе</h2><div class="panel"><button class="linkbtn" data-go="passport">Паспорт курса</button> · <button class="linkbtn" data-go="plan">Тематический план</button></div>`;
}
function pgDoc(title, html, p, n){ return `<div class="panel"><h2>${esc(title)}</h2>${html}</div>${nav2(p, n)}`; }
/* тестовые задания к лекции: самопроверка на странице (результат не отправляется) */
function lecQ(n){
  const t = TESTS['L' + n]; if (!t) return '';
  const items = t.items.filter(q => q.q.indexOf('\n\n') < 0);
  const R = rng(n * 977 + 13), qs = items.map((q, i) => ({...q, opts: [q.ok, ...q.bad].map((o, k) => ({o, c: k === 0})).sort(() => R() - .5)}));
  window.LQ = qs;
  const qh = qs.map((q, i) => `<div class="q" data-i="${i}"><b>${i + 1}.</b> ${esc(q.q)}${q.opts.map((o, j) => `<label><input type="radio" name="lq${i}" value="${j}"> ${esc(o.o)}</label>`).join('')}<div class="ex small"></div></div>`).join('');
  return `<h3 class="blk">7. Тестовые задания</h3><p class="small">Самопроверка по теории лекции: ответы здесь не отправляются преподавателю.</p><div id="lq">${qh}</div>
    <p><button class="btn" id="lq-chk" type="button">Проверить ответы</button> <span id="lq-res" class="res"></span> · <button class="linkbtn" data-go="test/L${n}">Полный тест к лекции (результат получит преподаватель)</button></p>`;
}
function wireLecQ(){
  const b = $('#lq-chk'); if (!b || !window.LQ) return;
  b.onclick = () => { let got = 0;
    document.querySelectorAll('#lq .q').forEach(el => { const i = +el.dataset.i, c = el.querySelector('input:checked'), q = window.LQ[i], ok = c && q.opts[+c.value].c;
      if (ok) got++; el.classList.remove('ok', 'bad'); el.classList.add(ok ? 'ok' : 'bad');
      el.querySelector('.ex').innerHTML = ok ? '✓ верно' : `✗ верный ответ: <span class="corr">${esc(q.ok)}</span>${q.ex ? '<br>' + esc(q.ex) : ''}`; });
    $('#lq-res').textContent = `${got} из ${window.LQ.length}`; };
}
function pgLec(n){
  const l = C.lectures[n - 1], done = store.get('py-done', {})[n];
  return `<div class="panel"><h2>Лекция ${n}. ${esc(l.title)}</h2>${l.html}${lecQ(n)}<p><label><input type="checkbox" id="lec-done" ${done ? 'checked' : ''}> Лекция изучена</label> · <button class="linkbtn" data-go="test/L${n}">Пройти тест к лекции</button></p></div>`
    + nav2(n > 1 ? ['lec' + (n - 1), 'Лекция ' + (n - 1)] : null, n < 5 ? ['lec' + (n + 1), 'Лекция ' + (n + 1)] : ['pz1', 'Практическое занятие 1']);
}
/* практические занятия: условия + форма отчёта */
const REP = {get: n => store.get('py-rep-' + n, {}), set: (n, v) => store.set('py-rep-' + n, v)};
const TRK = {typed: 0, paste: 0};
function pgPz(n){
  const p = C.pz[n - 1], R = REP.get(n);
  const forms = p.tasks.map(t => `<div class="rt" data-task="${t.id}"><div class="hd">${esc(t.id)}. ${esc(t.t.slice(0, 120))}</div><textarea class="src" spellcheck="false" placeholder="# Ваша программа">${esc((R[t.id] || {}).code || '')}</textarea>
    <div class="bar"><button class="run" type="button">▶ Запустить</button></div><pre class="out">${esc((R[t.id] || {}).out || '')}</pre></div>`).join('');
  return `<div class="panel"><h2>Практическое занятие ${n}. ${esc(p.title)}</h2>${p.html}</div>
    <div class="panel" id="rep"><h2>Отчёт: решения</h2><p class="small">Пишите решение в поле каждой задачи и запускайте. Решения сохраняются на этом устройстве. Когда готовы, нажмите «Сдать преподавателю».</p>${forms}
    <p><button class="btn pri" id="r-send">Сдать преподавателю</button> <span class="small" id="r-st"></span></p></div>`
    + nav2(n === 1 ? ['lec3', 'Лекция 3'] : ['lec5', 'Лекция 5'], n === 1 ? ['lec4', 'Лекция 4'] : ['tests', 'Тесты']);
}
function wirePz(n){
  const p = C.pz[n - 1];
  document.querySelectorAll('.rt').forEach(box => {
    const id = box.dataset.task, ta = box.querySelector('textarea'), out = box.querySelector('.out');
    ta.rows = Math.max(5, ta.value.split('\n').length + 1);
    const save = () => { const R = REP.get(n); R[id] = {code: ta.value, out: out.textContent}; REP.set(n, R); };
    ta.addEventListener('input', e => { if (e.inputType && /^insert(Text|LineBreak)/.test(e.inputType)) TRK.typed += (e.data || '\n').length; save(); });
    ta.addEventListener('paste', () => { TRK.paste++; });
    ta.addEventListener('keydown', e => { if (e.key === 'Tab'){ e.preventDefault(); ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end'); } });
    box.querySelector('.run').onclick = async () => { out.classList.remove('err'); out.textContent = 'Загрузка Python…';
      try { const r = await runPy(ta.value); out.classList.toggle('err', r.err); out.textContent = r.out; } catch(e){ out.classList.add('err'); out.textContent = e.message; } save(); };
  });
  $('#r-send').onclick = async () => {
    const st = $('#r-st');
    if (!ME){ if (!SB){ st.innerHTML = '<span class="cl-err">Нет связи с сервером.</span>'; return; } authOpen('login', 'Войдите, чтобы сдать отчёт преподавателю.'); return; }
    const R = REP.get(n), tasks = p.tasks.map(t => ({id:t.id, t:t.t.slice(0, 160), code:(R[t.id] || {}).code || '', out:((R[t.id] || {}).out || '').slice(0, 600)})), filled = tasks.filter(t => t.code.trim().length > 10);
    if (!filled.length){ st.innerHTML = '<span class="cl-err">Пока нет ни одного решения.</span>'; return; }
    const chars = tasks.reduce((s, t) => s + t.code.length, 0), row = {kind:'report', ref:'PR' + n, title:'Практическое занятие ' + n, score:Math.round(100 * filled.length / tasks.length),
      data:{course:COURSE, typed:TRK.typed, paste:TRK.paste, chars, variant:1, method:'', tasks}};
    st.textContent = 'Отправка…'; $('#r-send').disabled = true;
    const {error} = await SB.from('submissions').insert(row);
    if (error) st.innerHTML = `<span class="cl-err">Не удалось отправить (${esc(error.message || 'нет связи')}). Проверьте интернет и нажмите ещё раз.</span>`;
    else st.innerHTML = `<span class="cl-ok">✓ Отчёт сдан ${new Date().toLocaleString('ru-RU')}: решено ${filled.length} из ${tasks.length}. Оценку смотрите в «Мои работы».</span>`;
    $('#r-send').disabled = false;
  };
}
/* тесты */
let TCUR = null;
const rng = seed => { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };
function pgTests(){
  const li = TEST_ORDER.map(id => { const t = TESTS[id], a = store.get('py-t-' + id, []);
    return `<li><button class="card" data-go="test/${id}" style="width:100%"><b>${esc(t.title)}</b><small>${t.items.length} заданий${a.length ? ` · попыток ${a.length} · лучший ${Math.max(...a.map(x => x.pct))} %` : ''}</small></button></li>`; }).join('');
  return `<div class="panel"><h2>Тесты</h2><p class="small">Тест можно пройти несколько раз. Результат уходит преподавателю, если вы вошли в учётную запись. Баллы начисляются автоматически, шкала: от 85 % — 5, от 70 % — 4, от 55 % — 3 (условная).</p><ul style="list-style:none;padding:0;display:grid;gap:10px">${li}</ul></div>`;
}
function pgTest(id){
  const t = TESTS[id]; if (!t) return '<p>Тест не найден.</p>';
  if (SB && !ME){ setTimeout(() => authOpen('login', 'Войдите, чтобы результат теста получил преподаватель.', () => go('test/' + id)), 30); }
  const seed = Date.now() % 1e9, R = rng(seed);
  const items = t.items.map(q => ({...q, opts: [q.ok, ...q.bad].map((o, i) => ({o, c: i === 0})).sort(() => R() - .5)})).sort(() => R() - .5);
  TCUR = {id, seed, items, t0: Date.now(), A: items.map(() => null), done: false};
  if (ME) cloudEv('test_start', id);
  const qh = items.map((q, i) => { const parts = q.q.split('\n\n'), txt = parts[0], code = parts.slice(1).join('\n\n');
    return `<div class="q" data-i="${i}"><b>${i + 1}.</b> ${esc(txt).replace(/\n/g, '<br>')}${code ? `<pre>${esc(code)}</pre>` : ''}${q.opts.map((o, j) => `<label><input type="radio" name="q${i}" value="${j}"> ${esc(o.o)}</label>`).join('')}<div class="ex small"></div></div>`; }).join('');
  return `<div class="panel"><h2>${esc(t.title)}</h2>${CLOUD && !SB_FAIL ? '' : '<p class="cl-warn">Нет связи с сервером: тест можно пройти, но результат останется только на этом устройстве.</p>'}
    <div id="tq">${qh}</div><p><button class="btn pri" id="t-sub">Завершить тест</button> <span id="t-res"></span></p></div>${nav2(['tests', 'К списку тестов'], null)}`;
}
function wireTest(){
  const T = TCUR; if (!T) return;
  $('#t-sub').onclick = () => {
    if (T.done) return; document.querySelectorAll('.q').forEach(el => { const i = +el.dataset.i, c = el.querySelector('input:checked'); T.A[i] = c ? +c.value : null; });
    if (T.A.some(a => a == null) && !confirm('Есть вопросы без ответа. Завершить тест?')) return;
    T.done = true; const lv = {}; let got = 0;
    T.items.forEach((q, i) => { const ok = T.A[i] != null && q.opts[T.A[i]].c; if (ok) got++; (lv[q.lv] = lv[q.lv] || [0, 0]); lv[q.lv][1]++; if (ok) lv[q.lv][0]++;
      const el = document.querySelector(`.q[data-i="${i}"]`); el.classList.add(ok ? 'ok' : 'bad'); el.querySelectorAll('input').forEach(x => { x.disabled = true; if (+x.value === T.A[i]) x.parentNode.classList.add('pick'); });
      el.querySelector('.ex').innerHTML = ok ? '✓ верно' : `✗ верный ответ: <span class="corr">${esc(q.ok)}</span>${q.ex ? '<br>' + esc(q.ex) : ''}`; });
    const n = T.items.length, pct = Math.round(100 * got / n), [g, gt] = tGrade(pct);
    $('#t-sub').disabled = true; $('#t-res').innerHTML = `<span class="res">${got} из ${n} · ${pct} % · оценка ${g} (${gt})</span>`;
    const a = store.get('py-t-' + T.id, []); a.push({pct, at: Date.now()}); store.set('py-t-' + T.id, a);
    if (!CLOUD || !ME) return;
    const row = {kind:'test', ref:T.id, title:TESTS[T.id].title, score:pct, grade:g, data:{course:COURSE, sid:ME.id + '-' + T.seed, lv, sec:Math.round((Date.now() - T.t0) / 1000), typed:0, paste:0, got, auto:n,
      items:T.items.map((q, i) => ({k:i, lv:q.lv, t:'mc', s:T.A[i] != null && q.opts[T.A[i]].c ? 1 : 0, q:q.q.slice(0, 160), a:T.A[i] != null ? q.opts[T.A[i]].o.slice(0, 300) : ''})), open:[]}};
    const q = CQ.get(); q.push({qid:qid(), t:'submissions', uid:ME.id, row}); CQ.set(q); cloudFlush();
    $('#t-res').insertAdjacentHTML('afterend', `<p class="cl-ok">✓ Результат отправлен преподавателю (${esc(ME.fio)}, ${esc(ME.grp)}).</p>`);
  };
}
/* маршрутизатор */
function go(id){ if (location.hash.slice(1) === id) route(); else location.hash = id; }
function route(){
  const id = location.hash.slice(1) || 'home'; curTab = id; renderTabs(id); const m = $('#main'); let h = '';
  const mm = /^lec(\d)$/.exec(id), pz = /^pz(\d)$/.exec(id), tt = /^test\/(\w+)$/.exec(id);
  if (id === 'home') h = pgHome();
  else if (id === 'passport') h = pgDoc('Паспорт курса', C.passport, null, ['plan', 'Тематический план']);
  else if (id === 'plan') h = pgDoc('Тематический план', C.plan, ['passport', 'Паспорт курса'], ['lec1', 'Лекция 1']);
  else if (mm && C.lectures[+mm[1] - 1]) h = pgLec(+mm[1]);
  else if (pz && C.pz[+pz[1] - 1]) h = pgPz(+pz[1]);
  else if (id === 'tests') h = pgTests();
  else if (tt) h = pgTest(tt[1]);
  else if (id === 'exam') h = pgDoc('Зачёт', C.exam, ['tests', 'Тесты'], ['refs', 'Литература']);
  else if (id === 'refs') h = pgDoc('Литература и ресурсы', C.refs, ['exam', 'Зачёт'], null);
  else h = pgHome();
  m.innerHTML = h; document.body.classList.toggle('is-cover', !!m.querySelector('.cover')); wireCode(m); window.scrollTo(0, 0);
  if (mm){ wireLecQ(); if (ME && sessOnce('py-lec-' + mm[1])) cloudEv('lecture', mm[1]); const cb = $('#lec-done'); if (cb) cb.onchange = () => { const d = store.get('py-done', {}); d[mm[1]] = cb.checked; store.set('py-done', d); if (cb.checked) cloudEv('lecture_done', mm[1]); }; }
  if (pz){ wirePz(+pz[1]); if (ME && sessOnce('py-pr-' + pz[1])) cloudEv('practice', pz[1]); }
  if (tt) wireTest();
}
document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g){ e.preventDefault(); go(g.dataset.go); } });
addEventListener('hashchange', route);
route(); cloudInit();
