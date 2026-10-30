const SESSION_KEY = 'zt-campus-session';
const TRACE_KEY = 'zt-campus-trace';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let session = readSession();
let trace = readTrace();
let activeView = 'overview';
let gradesLoaded = false;
let auditLoaded = false;

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function readTrace() {
  try { return JSON.parse(sessionStorage.getItem(TRACE_KEY) || '[]'); } catch { return []; }
}
function persistSession() {
  if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else sessionStorage.removeItem(SESSION_KEY);
}
function persistTrace() { sessionStorage.setItem(TRACE_KEY, JSON.stringify(trace.slice(0, 12))); }

class ApiError extends Error {
  constructor(message, status, payload) { super(message); this.status = status; this.payload = payload; }
}

async function request(path, { method = 'GET', body, traceRequest = true, retry = true, deviceId = session?.deviceId } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (deviceId) headers['X-Device-ID'] = deviceId;
  if (session?.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;

  let response;
  try {
    response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    if (traceRequest) addTrace(path, method, 'deny', 'Gateway tidak dapat dijangkau');
    throw new ApiError('Gateway tidak dapat dijangkau. Pastikan layanan berjalan, lalu coba lagi.', 0);
  }

  if (response.status === 401 && retry && session?.refreshToken && path !== '/auth/refresh') {
    try {
      const refreshed = await request('/auth/refresh', { method: 'POST', body: { refreshToken: session.refreshToken }, traceRequest: false, retry: false });
      updateAccessToken(refreshed.accessToken, refreshed.expiresIn);
      return request(path, { method, body, traceRequest, retry: false, deviceId });
    } catch (error) {
      if (error.status === 401) await logout(false);
      throw error;
    }
  }

  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) {
    const message = payload.reason || payload.error || `Permintaan ditolak (${response.status})`;
    if (traceRequest) addTrace(path, method, 'deny', message);
    throw new ApiError(message, response.status, payload);
  }
  if (traceRequest) addTrace(path, method, 'allow', successReason(path, method));
  return payload;
}

function successReason(path, method) {
  if (path === '/auth/login') return 'Identitas dan perangkat terverifikasi';
  if (path === '/auth/refresh') return 'Refresh token valid; access token diperbarui';
  if (path === '/auth/logout') return 'Refresh token dicabut';
  if (path === '/admin/audit') return 'Admin membaca audit log';
  if (/^\/kelas\/\d+\/finalisasi$/.test(path)) return 'Nilai final; sinkronisasi transkrip diminta';
  if (path === '/nilai') return 'Role diizinkan melihat nilai';
  if (path.startsWith('/nilai/')) return 'Nilai berhasil diperbarui';
  if (path.startsWith('/transkrip/')) return 'Akses transkrip diizinkan';
  if (path === '/health') return 'Gateway merespons';
  return `${method} berhasil`;
}

function updateAccessToken(accessToken, expiresIn = '10m') {
  const duration = Number.parseInt(expiresIn, 10) || 10;
  session.accessToken = accessToken;
  session.accessExpiresAt = Date.now() + duration * 60 * 1000;
  persistSession();
  updateTokenExpiry();
}

function updateTokenExpiry() {
  const output = $('#token-expiry');
  if (!output || !session?.accessExpiresAt) return;
  output.textContent = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(session.accessExpiresAt);
}

function addTrace(path, method, decision, reason) {
  trace.unshift({ path, method, decision, reason, time: new Date().toISOString() });
  trace = trace.slice(0, 12);
  persistTrace();
  renderTrace();
}

function roleLabel(role = '') {
  return ({ admin: 'Administrator', dosen: 'Dosen', mahasiswa: 'Mahasiswa' })[role] || role;
}
function initials(name = 'ZT') {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'ZT';
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function toast(message, type = '') {
  const region = $('#toast-region');
  const item = document.createElement('div');
  item.className = `toast ${type}`.trim();
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => item.remove(), 4200);
}

function renderTrace() {
  const list = $('#trace-list');
  $('#trace-count').textContent = `${trace.length} request${trace.length === 1 ? '' : 's'}`;
  if (!trace.length) {
    list.innerHTML = '<div class="trace-empty"><span class="empty-mark">⌁</span><div><strong>Belum ada permintaan</strong><span>Aktivitas yang Anda lakukan selama sesi ini muncul di sini.</span></div></div>';
    return;
  }
  list.innerHTML = trace.slice(0, 4).map((item) => {
    const isDenied = item.decision === 'deny';
    const time = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(item.time));
    return `<div class="trace-item"><span class="trace-indicator ${isDenied ? 'deny' : ''}"></span><div class="trace-copy"><strong>${escapeHtml(item.reason)}</strong><span>${escapeHtml(item.method)} ${escapeHtml(item.path)}</span></div><div class="trace-meta"><span class="trace-result ${isDenied ? 'deny' : ''}">${isDenied ? 'DENY' : 'ALLOW'}</span><span class="trace-time">${escapeHtml(time)}</span></div></div>`;
  }).join('');
}

function showApplication() {
  $('#login-screen').hidden = true;
  $('#app').hidden = false;
  const name = session.user.name || session.user.username;
  const monogram = initials(name);
  $('#user-name').textContent = name;
  $('#user-role').textContent = roleLabel(session.user.role);
  $('#top-name').textContent = name;
  $('#user-avatar').textContent = monogram;
  $('#top-avatar').textContent = monogram;
  $('#session-device').textContent = session.deviceId;
  $('#session-detail').textContent = `Masuk sebagai ${roleLabel(session.user.role)}. Access token berlaku 10 menit; refresh token berumur 1 hari.`;
  updateTokenExpiry();
  $('#grades-role').textContent = roleLabel(session.user.role);
  const role = session.user.role;
  $('[data-view="grades"]').hidden = !['dosen', 'mahasiswa'].includes(role);
  $('[data-view="transcript"]').hidden = !['admin', 'mahasiswa'].includes(role);
  $('[data-view="audit"]').hidden = role !== 'admin';
  if (role === 'mahasiswa') {
    $('#transcript-nim').value = session.user.nim || '';
    $('#transcript-nim').readOnly = true;
    $('#transcript-hint').textContent = 'Kebijakan membatasi akses Anda ke NIM sendiri. Permintaan untuk NIM lain akan ditolak.';
    $('#transcript-subtitle').textContent = 'Transkrip Anda sendiri. Gateway memeriksa bahwa NIM sesuai dengan identitas sesi.';
  } else {
    $('#transcript-nim').value = '';
    $('#transcript-nim').readOnly = false;
    $('#transcript-hint').textContent = 'Administrator dapat mencari transkrip mahasiswa. Setiap pencarian tetap diperiksa oleh policy engine.';
    $('#transcript-subtitle').textContent = 'Cari transkrip berdasarkan NIM. Akses mahasiswa dibatasi ke transkripnya sendiri.';
  }
  renderTrace();
  changeView('overview');
}

function showLogin() {
  $('#app').hidden = true;
  $('#login-screen').hidden = false;
  $('#login-form').reset();
  $('#login-error').hidden = true;
}

async function logout(sendRequest = true) {
  const previous = session;
  if (sendRequest && previous?.refreshToken) {
    try {
      await request('/auth/logout', { method: 'POST', body: { refreshToken: previous.refreshToken }, retry: false });
    } catch { /* Local session is still cleared when the network is unavailable. */ }
  }
  session = null;
  trace = [];
  gradesLoaded = false;
  auditLoaded = false;
  persistSession();
  persistTrace();
  showLogin();
}

function changeView(name) {
  activeView = name;
  $$('.view').forEach((view) => { view.hidden = view.id !== `view-${name}`; });
  $$('.nav-item').forEach((item) => {
    if (item.dataset.view === name) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  const label = ({ overview: 'Ikhtisar', grades: 'Nilai', transcript: 'Transkrip', audit: 'Audit log' })[name];
  $('#breadcrumb-title').textContent = label;
  $('#sidebar').classList.remove('open');
  if (name === 'grades' && !gradesLoaded) loadGrades();
  if (name === 'audit' && !auditLoaded) loadAudit();
}

function renderGrades(rows) {
  const container = $('#grades-table');
  $('#grade-count').textContent = `${rows.length} nilai`;
  if (!rows.length) {
    container.innerHTML = '<div class="empty-result">Belum ada nilai yang tersedia pada akun ini.</div>';
    return;
  }
  const isLecturer = session.user.role === 'dosen';
  const grouped = new Map();
  rows.forEach((row) => {
    const key = String(row.class_id ?? row.class_code);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });
  container.innerHTML = [...grouped.entries()].map(([classId, classRows]) => {
    const first = classRows[0];
    const numericClassId = Number(first.class_id);
    const hasClassId = Number.isInteger(numericClassId) && numericClassId > 0;
    const pending = classRows.some((row) => !Boolean(row.is_final));
    const finalizeButton = isLecturer && hasClassId
      ? `<button class="button ${pending ? 'button-dark' : 'button-outline'} finalize-button" data-class-id="${numericClassId}" data-pending="${pending}">${pending ? 'Finalisasi &amp; sinkronkan' : 'Sinkronkan ulang transkrip'}</button>`
      : '';
    const tableRows = classRows.map((row) => {
      const canEdit = isLecturer && !Boolean(row.is_final);
      const student = isLecturer && row.student_id ? `<span class="subtext">ID mahasiswa ${escapeHtml(row.student_id)}</span>` : '';
      const value = row.score === null || row.score === undefined ? '—' : Number(row.score).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const score = canEdit
        ? `<form class="grade-form" data-grade-id="${Number(row.id)}"><input class="grade-edit" name="score" type="number" min="0" max="100" step="0.01" required aria-label="Nilai baru, ${escapeHtml(row.class_code)}" value="${row.score ?? ''}"><button class="save-grade" type="submit">Simpan</button></form>`
        : `<span class="score">${value}</span>`;
      return `<tr><td><span class="class-code">${escapeHtml(row.class_code)}</span>${student}</td><td>${escapeHtml(row.course_name)}</td><td class="numeric">${score}</td><td><span class="state-pill ${row.is_final ? 'final' : ''}">${row.is_final ? 'Final' : 'Draft'}</span></td></tr>`;
    }).join('');
    const actionNote = isLecturer
      ? `<span class="finalize-note">${!hasClassId ? 'ID kelas belum tersedia. Restart Service Nilai, lalu muat ulang data.' : pending ? 'Finalisasi mengunci nilai dan meminta sinkronisasi transkrip.' : 'Nilai sudah final. Sinkronkan ulang jika service transkrip sempat gagal.'}</span>`
      : '';
    return `<section class="course-group"><header><div><span class="class-code">${escapeHtml(first.class_code)}</span><strong>${escapeHtml(first.course_name)}</strong><span class="subtext">${classRows.length} rekaman nilai</span></div><div class="course-actions">${actionNote}${finalizeButton}</div></header><div class="table-wrap"><table><thead><tr><th>Kelas / Mahasiswa</th><th>Mata kuliah</th><th class="numeric">Nilai</th><th>Status</th></tr></thead><tbody>${tableRows}</tbody></table></div></section>`;
  }).join('');
  $$('.grade-form', container).forEach((form) => form.addEventListener('submit', saveGrade));
  $$('.finalize-button', container).forEach((button) => button.addEventListener('click', finalizeClass));
}

async function finalizeClass(event) {
  const button = event.currentTarget;
  const classId = Number(button.dataset.classId);
  if (!Number.isInteger(classId) || classId <= 0) {
    toast('ID kelas tidak diterima dari Service Nilai. Restart Service Nilai, lalu muat ulang.', 'error');
    return;
  }
  const isPending = button.dataset.pending === 'true';
  const prompt = isPending
    ? 'Finalisasi nilai kelas ini? Nilai akan dikunci, lalu Service Nilai meminta Service Transkrip menyinkronkannya.'
    : 'Kirim ulang permintaan sinkronisasi nilai final ke Service Transkrip?';
  if (!window.confirm(prompt)) return;
  button.disabled = true;
  try {
    const result = await request(`/kelas/${classId}/finalisasi`, { method: 'POST', body: {} });
    const synced = result.transcript?.syncedRecords ?? 0;
    toast(`Nilai difinalisasi. ${synced} rekaman disinkronkan ke transkrip.`, 'success');
    gradesLoaded = false;
    await loadGrades();
  } catch (error) {
    if (error.payload?.finalized) {
      toast('Nilai sudah terkunci, tetapi sinkronisasi transkrip gagal. Periksa service dan audit log.', 'error');
      gradesLoaded = false;
      await loadGrades();
    } else {
      toast(error.message, 'error');
      button.disabled = false;
    }
  }
}

async function loadGrades() {
  const container = $('#grades-table');
  container.innerHTML = '<div class="table-loading"><span class="spinner"></span>Memverifikasi akses ke Service Nilai…</div>';
  try {
    const result = await request('/nilai');
    gradesLoaded = true;
    renderGrades(Array.isArray(result.data) ? result.data : []);
  } catch (error) {
    gradesLoaded = false;
    container.innerHTML = `<div class="empty-result">${escapeHtml(error.message)}${error.payload?.reason ? `<br><span class="subtext">Alasan kebijakan: ${escapeHtml(error.payload.reason)}</span>` : ''}</div>`;
  }
}

async function saveGrade(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const gradeId = Number(form.dataset.gradeId);
  const score = Number(new FormData(form).get('score'));
  const button = $('button', form);
  button.disabled = true;
  try {
    await request(`/nilai/${gradeId}`, { method: 'PUT', body: { score } });
    toast('Nilai diperbarui oleh policy engine.', 'success');
    await loadGrades();
  } catch (error) {
    toast(error.message, 'error');
    button.disabled = false;
  }
}

async function loadAudit() {
  const container = $('#audit-table');
  container.innerHTML = '<div class="table-loading"><span class="spinner"></span>Mengambil audit log dari server…</div>';
  try {
    const result = await request('/admin/audit?limit=30');
    const rows = Array.isArray(result.data) ? result.data : [];
    auditLoaded = true;
    $('#audit-count').textContent = `${rows.length} event`;
    if (!rows.length) {
      container.innerHTML = '<div class="empty-result">Belum ada keputusan akses yang tercatat.</div>';
      return;
    }
    const body = rows.map((row) => {
      const allowed = row.decision === 'allow';
      const device = row.device_id || 'Service';
      return `<tr><td>${escapeHtml(formatDate(row.event_time))}</td><td><span class="mono">${escapeHtml(row.subject)}</span></td><td><span class="mono">${escapeHtml(row.endpoint)}</span></td><td><span class="mono">${escapeHtml(device)}</span></td><td><span class="state-pill ${allowed ? 'final' : 'denied'}">${allowed ? 'ALLOW' : 'DENY'}</span></td><td>${escapeHtml(row.reason)}</td></tr>`;
    }).join('');
    container.innerHTML = `<table class="audit-table"><thead><tr><th>Waktu</th><th>Subjek</th><th>Endpoint</th><th>Perangkat</th><th>Keputusan</th><th>Alasan</th></tr></thead><tbody>${body}</tbody></table>`;
  } catch (error) {
    auditLoaded = false;
    $('#audit-count').textContent = 'Tidak tersedia';
    container.innerHTML = `<div class="empty-result">${escapeHtml(error.message)}${error.payload?.reason ? `<br><span class="subtext">Alasan kebijakan: ${escapeHtml(error.payload.reason)}</span>` : ''}</div>`;
  }
}

function renderTranscript(result) {
  const container = $('#transcript-result');
  const rows = Array.isArray(result.data) ? result.data : [];
  if (!result.student) {
    container.innerHTML = '<div class="empty-result">Mahasiswa ditemukan, tetapi belum memiliki transkrip tersinkron.</div>';
    return;
  }
  const avg = rows.length ? rows.reduce((sum, row) => sum + Number(row.score || 0), 0) / rows.length : null;
  const tableRows = rows.map((row) => `<tr><td><span class="class-code">${escapeHtml(row.class_code)}</span></td><td>${escapeHtml(row.course_name)}</td><td class="numeric"><span class="score">${Number(row.score).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></td><td class="numeric">${escapeHtml(formatDate(row.synced_at))}</td></tr>`).join('');
  container.innerHTML = `<section class="content-panel table-panel transcript-card"><div class="transcript-person"><div><strong>${escapeHtml(result.student.name)}</strong><small>NIM ${escapeHtml(result.student.nim)}</small></div><div class="transcript-summary"><b>${avg === null ? '—' : avg.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b><span>rata-rata</span></div></div>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Kelas</th><th>Mata kuliah</th><th class="numeric">Nilai final</th><th class="numeric">Disinkronkan</th></tr></thead><tbody>${tableRows}</tbody></table></div>` : '<div class="empty-result">Belum ada nilai final yang disinkronkan.</div>'}</section>`;
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = $('.login-submit', event.currentTarget);
  const errorBox = $('#login-error');
  const username = String(form.get('username')).trim();
  const password = String(form.get('password'));
  const deviceId = String(form.get('deviceId')).trim();
  button.disabled = true;
  $('span:first-child', button).textContent = 'Memverifikasi…';
  errorBox.hidden = true;
  try {
    const result = await request('/auth/login', { method: 'POST', body: { username, password }, deviceId });
    session = { accessToken: result.accessToken, refreshToken: result.refreshToken, deviceId, user: result.user };
    updateAccessToken(result.accessToken, result.expiresIn);
    persistSession();
    showApplication();
  } catch (error) {
    errorBox.textContent = error.status === 403 ? 'Perangkat tidak terdaftar untuk akun ini. Periksa kembali ID perangkat kepada administrator.' : error.message;
    errorBox.hidden = false;
  } finally {
    button.disabled = false;
    $('span:first-child', button).textContent = 'Verifikasi dan masuk';
  }
});

$$('.nav-item').forEach((item) => item.addEventListener('click', () => changeView(item.dataset.view)));
$('#logout-button').addEventListener('click', () => logout());
$('#user-menu').addEventListener('click', () => toast(`Sesi aktif · ${roleLabel(session.user.role)} · ${session.deviceId}`));
$('#menu-button').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#refresh-token-button').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await request('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: session.refreshToken },
      retry: false,
    });
    updateAccessToken(result.accessToken, result.expiresIn);
    toast(`Access token baru aktif sampai ${$('#token-expiry').textContent}.`, 'success');
  } catch (error) {
    toast(error.message, 'error');
    if (error.status === 401) await logout(false);
  } finally { button.disabled = false; }
});
$('#refresh-button').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await request('/health', { traceRequest: false });
    toast('Gateway merespons. Token diverifikasi ulang pada permintaan data.', 'success');
  } catch (error) { toast(error.message, 'error'); }
  finally { button.disabled = false; }
});
$$('[data-refresh="grades"]').forEach((button) => button.addEventListener('click', () => { gradesLoaded = false; loadGrades(); }));
$('#refresh-audit-button').addEventListener('click', () => { auditLoaded = false; loadAudit(); });
$('#transcript-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const nim = $('#transcript-nim').value.trim();
  if (!nim) return;
  const output = $('#transcript-result');
  output.innerHTML = '<div class="table-loading"><span class="spinner"></span>Policy engine sedang memverifikasi permintaan…</div>';
  try {
    const result = await request(`/transkrip/${encodeURIComponent(nim)}`);
    renderTranscript(result);
  } catch (error) {
    output.innerHTML = `<div class="empty-result">${escapeHtml(error.message)}${error.payload?.reason ? `<br><span class="subtext">Alasan kebijakan: ${escapeHtml(error.payload.reason)}</span>` : ''}</div>`;
  }
});

if (session?.accessToken && session?.deviceId && session?.user) showApplication();
else showLogin();
