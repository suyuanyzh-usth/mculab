/*
 * app.js — 应用入口
 * 职责：登录/注册、会话恢复、视图路由、全局快捷键、各视图模块装配。
 * 所有业务视图在 js/ui/view-*.js 中；本文件只做编排。
 */
import { $, $$, api, state, bus, toast, modal, closeModal, setView, setUnauthorizedHandler, esc, normalizeCredential } from './ui/core.js';

import * as vProblems from './ui/view-problems.js';
import * as vIde from './ui/view-ide.js';
import * as vCircuit from './ui/view-circuit.js';
import * as vSim from './ui/view-sim.js';
import * as vScope from './ui/view-scope.js';
import * as vReport from './ui/view-report.js';
import * as vQa from './ui/view-qa.js';
import * as vTeacher from './ui/view-teacher.js';
import * as vManage from './ui/view-manage.js';
import * as vGrade from './ui/view-grade.js';
import * as vOpen from './ui/view-open.js';

const VIEWS = {
  problems: vProblems, ide: vIde, circuit: vCircuit,
  sim: vSim, scope: vScope, report: vReport, qa: vQa,
  open: vOpen, manage: vManage, grade: vGrade, teacher: vTeacher
};

/* ================================================================ 启动 */
boot();
bindNetBar();

/* ------------------------------------------------------------------
 * 网络/安全上下文提示
 * ------------------------------------------------------------------
 * "任意网络可用"要落到用户可感知的层面：
 *   ① 断网：告知"已缓存部分仍可用，编译/提交需要联网"，避免误以为平台坏了；
 *   ② 非安全上下文（公网 HTTP）：Web Serial 会被浏览器禁用，
 *      必须明确告诉学生"仿真照常，真机烧录需 HTTPS"，而不是让按钮静默失效。
 */
function bindNetBar() {
  const bar = $('#netBar');
  if (!bar) return;

  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  const insecure = !window.isSecureContext && !isLocal;
  let dismissed = false;
  try { dismissed = sessionStorage.getItem('mculab.netbar.dismissed') === '1'; } catch { }

  function render() {
    if (state.offline && dismissed !== 'offline') {
      bar.className = 'netbar offline';
      bar.innerHTML = '<span>当前处于离线状态：已加载过的页面与仿真可继续使用；编译、登录、提交需要联网。</span>';
      document.body.classList.add('has-netbar');
      return;
    }
    if (insecure && !dismissed) {
      bar.className = 'netbar';
      bar.innerHTML = '<span>当前通过 HTTP 访问：仿真与实验全部可用；「连接真实开发板 / STC 烧录」需要 HTTPS 或 localhost。</span>'
        + '<button class="btn sm" id="netBarClose">知道了</button>';
      document.body.classList.add('has-netbar');
      const b = $('#netBarClose');
      if (b) b.onclick = () => {
        dismissed = true;
        try { sessionStorage.setItem('mculab.netbar.dismissed', '1'); } catch { }
        bar.classList.add('hidden');
        document.body.classList.remove('has-netbar');
      };
      return;
    }
    bar.classList.add('hidden');
    document.body.classList.remove('has-netbar');
  }

  state.offline = !navigator.onLine;
  window.addEventListener('online', async () => {
    state.offline = false; dismissed = false; render();
    toast('网络已恢复', 'ok');
    // 从离线模式回到在线：重新拉取题库与身份
    try {
      const me = await api('/api/me');
      if (me && me.user) { cacheUser(me.user); vProblems.reload(); }
      else location.reload();
    } catch { }
  });
  window.addEventListener('offline', () => { state.offline = true; render(); });
  bus.on('view', render);
  render();
}

async function boot() {
  bindAuth();
  try {
    const info = await api('/api/info');
    state.info = info;
    applySiteInfo(info);
  } catch (e) { /* 服务未就绪时也允许渲染登录页 */ }

  try {
    const me = await api('/api/me');
    if (me && me.user) { cacheUser(me.user); return enterApp(me.user); }
  } catch (e) {
    /*
     * 离线恢复：断网时无法向服务端校验会话，但学生可能正在做实验。
     * 只要本地存有上次登录身份，就以"离线模式"直接进入应用，
     * 让他继续画图/仿真；编译与提交会给出"需要联网"的明确提示。
     */
    const cached = readCachedUser();
    if ((e && e.offline) || navigator.onLine === false) {
      if (cached) {
        // 注意：浏览器有时在断网瞬间仍报告 navigator.onLine=true，
        // 因此这里必须显式置位，提示条才会出现。
        state.offline = true;
        toast('离网模式：可继续画图与仿真，编译/提交需联网', 'warn', 5000);
        return enterApp(cached, { offline: true });
      }
    }
  }

  $('#authView').classList.remove('hidden');
  $('#appView').classList.add('hidden');
}

/* 本地记住上次登录的身份，用于断网时的离线恢复（不含任何凭据） */
function cacheUser(u) {
  try { localStorage.setItem('mculab.lastUser', JSON.stringify({ id: u.id, username: u.username, role: u.role, name: u.name, className: u.className, studentNo: u.studentNo })); } catch { }
}
function readCachedUser() {
  try { const s = localStorage.getItem('mculab.lastUser'); return s ? JSON.parse(s) : null; } catch { return null; }
}

function applySiteInfo(info) {
  if (!info) return;
  if (info.siteName) {
    document.title = info.siteName;
    $('#siteName').textContent = info.siteName;
    $('#siteNameInput') && ($('#siteNameInput').value = info.siteName);
  }
  $('#siteAnnounce').textContent = info.announce || '';
  const tc = info.toolchain || {};
  const badge = $('#compileBadge');
  if (badge) {
    badge.textContent = tc.sdccPresent ? '编译器：SDCC 就绪' : '编译器：内置汇编通路';
    badge.className = 'muted small ' + (tc.sdccPresent ? 'ok' : 'off');
  }
  // 不要写死版本号：云端用的是 Linux 版 SDCC（4.2），本机是 4.6，写死会误导排障
  $('#toolchainInfo').textContent = tc.sdccPresent ? '工具链：SDCC 已就绪' : '工具链：内置汇编器（未检测到 SDCC）';

  /*
   * 注册入口随教师设置联动：
   *   · 关闭自助注册 → 禁用"学生注册"页签，并说明原因；
   *   · 关闭名单匹配 → 学号/班级不再必填（公开课场景）；
   *   · 两者都开 → 学号与班级必填，且必须命中教师导入的名单。
   */
  const regTab = document.querySelector('.tab-btn[data-auth=register]');
  const regForm = $('#registerForm');
  if (regTab && regForm) {
    const allow = info.allowSelfRegister !== false;
    regTab.disabled = !allow;
    regTab.style.opacity = allow ? '' : '.45';
    regTab.title = allow ? '' : '教师已关闭自助注册';
    const noInp = regForm.querySelector('input[name=studentNo]');
    const clsInp = regForm.querySelector('input[name=className]');
    const needRoster = info.requireRoster !== false;
    if (noInp) noInp.required = needRoster;
    if (clsInp) clsInp.required = needRoster;
    const hint = regForm.querySelector('.hint');
    if (hint) {
      hint.innerHTML = !allow
        ? '当前已关闭自助注册，请使用教师下发的账号密码登录。'
        : needRoster
          ? '只有教师已导入名单中的「学号 + 班级」才能注册；若提示不在名单中，请联系教师。'
          : '当前允许自由注册，学号可留空（教师可在后台开启名单校验）。';
    }
    if (!allow && !regForm.classList.contains('hidden')) {
      regForm.classList.add('hidden');
      $('#loginForm').classList.remove('hidden');
      $$('.tab-btn[data-auth]').forEach(x => x.classList.toggle('active', x.dataset.auth === 'login'));
    }
  }
}

/* ================================================================ 登录 / 注册 */
/* 登录/注册的内联错误提示：比一闪而过的 toast 可靠得多 */
function showAuthError(sel, msg, extra = '') {
  const box = $(sel);
  if (!box) return;
  box.innerHTML = '<b>' + esc(msg) + '</b>' + (extra ? '<br>' + extra : '');
  box.classList.add('show');
}
function clearAuthError(sel) {
  const box = $(sel);
  if (box) { box.classList.remove('show'); box.textContent = ''; }
}

function bindAuth() {
  // "显示密码"开关：输错时最常见的原因就是打错了/被自动填充了旧密码
  $$('input[data-pwd-toggle]').forEach(cb => {
    cb.addEventListener('change', () => {
      const form = cb.closest('form');
      const inp = form && form.querySelector('input[name=password]');
      if (inp) inp.type = cb.checked ? 'text' : 'password';
    });
  });
  // 用户一改动输入就清掉上一次的错误，避免"红字一直挂着"
  [['#loginForm', '#authError'], ['#registerForm', '#authError2'], ['#teacherRegForm', '#authError3']].forEach(([f, e]) => {
    const form = $(f);
    if (form) form.addEventListener('input', () => clearAuthError(e));
  });

  $$('.tab-btn[data-auth]').forEach(b => b.addEventListener('click', () => {
    $$('.tab-btn[data-auth]').forEach(x => x.classList.toggle('active', x === b));
    const map = { login: '#loginForm', register: '#registerForm', teacherReg: '#teacherRegForm' };
    for (const [k, sel] of Object.entries(map)) {
      const f = $(sel);
      if (f) f.classList.toggle('hidden', b.dataset.auth !== k);
    }
  }));

  const tForm = $('#teacherRegForm');
  if (tForm) {
    tForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const btn = e.target.querySelector('button[type=submit]');
      btn.classList.add('busy');
      try {
        clearAuthError('#authError3');
        const r = await api('/api/auth/register-teacher', {
          method: 'POST',
          body: {
            username: normalizeCredential(f.get('username')),
            password: normalizeCredential(f.get('password')),
            name: String(f.get('name') || '').trim(),
            inviteCode: normalizeCredential(f.get('inviteCode'))
          }
        });
        cacheUser(r.user);
        toast('教师账号已创建。你的邀请码：' + r.inviteCode, 'ok', 8000);
        if (r.inviteCode) try { localStorage.setItem('mculab.myInvite', r.inviteCode); } catch { }
        enterApp(r.user);
      } catch (err) {
        showAuthError('#authError3', err.message, err.authFailed ? '' : '');
        toast(err.message, 'err');
      } finally { btn.classList.remove('busy'); }
    });
  }

  // 教师注册提示随"是否已有教师"变化
  (async () => {
    try {
      const st = await api('/api/auth/teacher-registration');
      const hint = $('#teacherRegHint');
      const codeInp = tForm && tForm.querySelector('input[name=inviteCode]');
      if (hint) {
        hint.textContent = st.hasTeacher
          ? '教师注册需要邀请码，请向已有教师索取（教师后台可查看自己的邀请码）。'
          : '当前还没有教师账号：第一个注册的教师将自动成为管理员，并立即获得自己的邀请码。';
      }
      if (codeInp) codeInp.required = !!st.hasTeacher;
    } catch { }
  })();

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    btn.classList.add('busy');
    try {
      clearAuthError('#authError');
      const r = await api('/api/auth/login', {
        method: 'POST',
        body: { username: normalizeCredential(f.get('username')), password: normalizeCredential(f.get('password')) }
      });
      cacheUser(r.user);
      toast('登录成功', 'ok');
      enterApp(r.user);
    } catch (err) {
      let extra = '';
      if (err.authFailed) {
        extra = '请确认大小写与输入法（可用上方"显示密码"核对）。'
          + '<br>教师忘记密码：在服务器上运行 <code>node tools/reset_password.mjs teacher 新密码</code> 重置。'
          + '<br>学生忘记密码：请任课教师在「教师后台 → 学情」里点"改密"。';
      }
      showAuthError('#authError', err.message, extra);
      toast(err.message, 'err');
    }
    finally { btn.classList.remove('busy'); }
  });

  $('#registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    btn.classList.add('busy');
    try {
      const r = await api('/api/auth/register', {
        method: 'POST',
        body: {
          username: normalizeCredential(f.get('username')), password: normalizeCredential(f.get('password')),
          name: f.get('name'),
          className: normalizeCredential(f.get('className')), studentNo: normalizeCredential(f.get('studentNo'))
        }
      });
      toast('注册成功', 'ok');
      enterApp(r.user);
    } catch (err) {
      showAuthError('#authError2', err.message);
      toast(err.message, 'err');
    }
    finally { btn.classList.remove('busy'); }
  });

  $('#btnLogout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { }
    location.reload();
  });

  $('#btnChangePwd').addEventListener('click', () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <label>原密码<input class="input" id="pwdOld" type="password" autocomplete="current-password"></label>
      <label>新密码（至少 6 位）<input class="input" id="pwdNew" type="password" autocomplete="new-password"></label>
      <label>确认新密码<input class="input" id="pwdNew2" type="password" autocomplete="new-password"></label>
      <div class="small muted">忘记密码请联系任课教师重置。</div>`;
    modal('修改密码', wrap, [
      { label: '取消' },
      {
        label: '确定修改', primary: true, onClick: async () => {
          const o = $('#pwdOld').value, n = $('#pwdNew').value, n2 = $('#pwdNew2').value;
          if (n !== n2) { toast('两次输入的新密码不一致', 'err'); return false; }
          try {
            await api('/api/auth/change-password', { method: 'POST', body: { oldPassword: o, newPassword: n } });
            toast('密码已更新', 'ok');
          } catch (e) { toast(e.message, 'err'); return false; }
        }
      }
    ]);
  });

  $('#modalClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      if (state.view === 'ide') bus.emit('compile-request');
    }
  });

  setUnauthorizedHandler(() => {
    $('#appView').classList.add('hidden');
    $('#authView').classList.remove('hidden');
    toast('登录状态已失效，请重新登录', 'warn');
  });
}

/* ================================================================ 进入应用 */
async function enterApp(user, opts = {}) {
  state.user = user;
  $('#authView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#rolePill').textContent = user.role === 'teacher' ? '教师' : '学生';
  $('#rolePill').className = 'pill' + (user.role === 'teacher' ? ' teacher' : '');
  $('#userLabel').textContent = user.name ? `${user.name}${user.studentNo ? ' · ' + user.studentNo : ''}` : user.username;
  $('#teacherNavBtn').classList.toggle('hidden', user.role !== 'teacher');
  // 教师专属视图：实验任务 / 成绩册
  $$('.teacher-only').forEach(b => b.classList.toggle('hidden', user.role !== 'teacher'));

  // 导航
  $$('.nav-btn').forEach(b => {
    b.onclick = () => {
      if ((b.dataset.view === 'teacher' || b.classList.contains('teacher-only')) && user.role !== 'teacher') return;
      setView(b.dataset.view);
    };
  });

  // 初始化各视图（仅一次）
  for (const [name, mod] of Object.entries(VIEWS)) {
    try { if (mod.init) mod.init(); }
    catch (e) { console.error('视图初始化失败:', name, e); }
  }
  bus.on('view', (name) => {
    const mod = VIEWS[name];
    if (mod && mod.show) { try { mod.show(); } catch (e) { console.error(e); } }
  });

  setView('problems');
  vProblems.show();

  // 编译器状态
  try {
    const st = await api('/api/compiler/status');
    const badge = $('#compileBadge');
    if (badge) {
      badge.textContent = st.sdccUsable ? '编译器：SDCC 就绪' : (st.sdccPresent ? '编译器：SDCC 异常' : '编译器：内置汇编通路');
      badge.className = 'muted small ' + (st.sdccUsable ? 'ok' : 'off');
      badge.title = st.sdccUsable ? `SDCC ${st.version}` : (st.error || 'SDCC 不可用，已启用内置汇编器降级通路');
    }
    state.compiler = st;
  } catch { }

  if (user.mustChangePwd) {
    setTimeout(() => toast('你正在使用初始密码，请尽快修改（右上角「改密码」）', 'warn', 6000), 900);
  }
}

/* 供视图模块调用：外部定位到某个视图 */
bus.on('request-view', (name) => setView(name));

export { VIEWS };
