/* ════════════════════════════════════════════
   FlowDay — script.js
   CRUD: Create, Read, Update, Delete
   Focus Timer · AI Plan · Charts · Analytics
════════════════════════════════════════════ */
'use strict';

// ── STATE ───────────────────────────────────
let allTasks       = [];
let currentFilter  = 'all';
let focusTaskId    = null;
let focusRunning   = false;
let focusInterval  = null;
let focusTotal     = 25 * 60;
let focusRemaining = 25 * 60;

const QUOTES = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Focus on being productive instead of busy.", author: "Tim Ferriss" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { text: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
  { text: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar" },
  { text: "Success is the sum of small efforts repeated day in and day out.", author: "Robert Collier" },
];

// ── INIT ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setDateLabel();
  setDailyQuote();
  loadAll();
});

function loadAll() {
  fetchTasks();
  fetchStats();
}

function setDateLabel() {
  const el = document.getElementById('date-label');
  if (!el) return;
  const days   = ['კვირა','ორშაბათი','სამშაბათი','ოთხშაბათი','ხუთშაბათი','პარასკევი','შაბათი'];
  const months = ['იანვარი','თებერვალი','მარტი','აპრილი','მაისი','ივნისი','ივლისი','აგვისტო','სექტემბერი','ოქტომბერი','ნოემბერი','დეკემბერი'];
  const now = new Date();
  el.textContent = `· ${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]}`;
}

function setDailyQuote() {
  const idx  = new Date().getDate() % QUOTES.length;
  const q    = QUOTES[idx];
  const txt  = document.querySelector('.quote-text');
  const auth = document.querySelector('.quote-author');
  if (txt)  txt.textContent  = `"${q.text}"`;
  if (auth) auth.textContent = `— ${q.author}`;
}

// ── NAVIGATION ──────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-' + name);
  const nav  = document.querySelector(`[data-page="${name}"]`);
  if (page) page.classList.add('active');
  if (nav)  nav.classList.add('active');
  if (name === 'focus')     renderFocusTaskList();
  if (name === 'analytics') renderAnalytics();
  if (name === 'tasks')     renderAllTasks();
  closeSidebar();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

// ── FETCH ───────────────────────────────────
async function fetchTasks() {
  try {
    const res = await fetch('/api/tasks');
    allTasks  = await res.json();
    renderDashTable();
    renderAllTasks();
    renderFocusTaskList();
    const urgent = allTasks.filter(t => t.deadline && daysLeft(t.deadline) <= 2).length;
    const badge  = document.getElementById('notif-badge');
    if (badge) badge.textContent = urgent;
  } catch(e) { console.error('fetchTasks:', e); }
}

async function fetchStats() {
  try {
    const res  = await fetch('/api/stats');
    const data = await res.json();
    renderStats(data);
    renderDonut(data.priority);
    renderUpcoming(data.upcoming);
    renderWeeklyChart(data.weekly, 'prod-chart');
  } catch(e) { console.error('fetchStats:', e); }
}

// ── RENDER STATS ────────────────────────────
function renderStats(d) {
  setText('s-total',     d.total);
  setText('s-completed', d.done_month);
  setText('s-progress',  d.in_progress);
  setText('s-rate',      d.completion_rate + '%');
  setText('a-total',  d.total);
  setText('a-done',   d.completed);
  setText('a-rate',   d.completion_rate + '%');
  setText('a-active', d.in_progress);
}

// ── DONUT ───────────────────────────────────
function renderDonut(p) {
  const total = p.high + p.medium + p.low || 1;
  const circ  = 2 * Math.PI * 48;
  const segs  = [
    { id: 'donut-high',   val: p.high,   offset: 75.4 },
    { id: 'donut-medium', val: p.medium, offset: null },
    { id: 'donut-low',    val: p.low,    offset: null },
  ];
  let cumulative = 75.4;
  segs.forEach((s, i) => {
    const len = (s.val / total) * circ;
    const el  = document.getElementById(s.id);
    if (!el) return;
    el.setAttribute('stroke-dasharray', `${len} ${circ - len}`);
    el.setAttribute('stroke-dashoffset', circ - cumulative);
    cumulative += len;
  });
  setText('donut-total', p.high + p.medium + p.low);
  setText('l-high',   p.high);
  setText('l-medium', p.medium);
  setText('l-low',    p.low);
}

// ── UPCOMING ────────────────────────────────
function renderUpcoming(list) {
  const el = document.getElementById('upcoming-list');
  if (!el) return;
  if (!list || !list.length) {
    el.innerHTML = '<div class="empty-small">Upcoming deadlines არ გაქვს</div>';
    return;
  }
  el.innerHTML = list.map(u => `
    <div class="upcoming-item">
      <span class="upcoming-name">${esc(u.title)}</span>
      <span class="upcoming-date">${formatDate(u.deadline)}</span>
      <span class="p-badge ${u.priority_label}">${u.priority_label}</span>
    </div>`).join('');
}

// ── WEEKLY CHART (Bar) ───────────────────────
function renderWeeklyChart(weekly, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const labels = ['ორშ','სამ','ოთხ','ხუთ','პარ','შაბ','კვი'];
  const days   = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }
  const map  = {};
  (weekly || []).forEach(w => map[w.d] = w.cnt);
  const vals = days.map(d => map[d] || 0);
  const max  = Math.max(...vals, 1);

  const dayLabels = days.map(d => {
    const dt = new Date(d + 'T12:00:00');
    const idx = dt.getDay() === 0 ? 6 : dt.getDay() - 1;
    return labels[idx];
  });

  if (max === 0) {
    el.innerHTML = '<div class="chart-empty">task-ები შეასრულე — chart გამოჩნდება!</div>';
    return;
  }

  el.innerHTML = `
    <div class="bar-chart-wrap">
      ${vals.map((v, i) => `
        <div class="bar-col">
          <div class="bar-val">${v > 0 ? v : ''}</div>
          <div class="bar-fill" style="height:${Math.max(v/max*110,4)}px" title="${v} task"></div>
          <div class="bar-lbl">${dayLabels[i]}</div>
        </div>`).join('')}
    </div>`;
}

// ── DASHBOARD TABLE ──────────────────────────
function renderDashTable() {
  const tbody  = document.getElementById('dash-task-tbody');
  const footer = document.getElementById('table-footer');
  if (!tbody) return;

  let filtered = currentFilter === 'all'
    ? allTasks
    : allTasks.filter(t => t.priority_label === currentFilter);
  const showing = filtered.slice(0, 6);

  if (!showing.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading-row">task-ები არ გაქვს</td></tr>';
    if (footer) footer.textContent = '';
    return;
  }

  tbody.innerHTML = showing.map(t => `
    <tr>
      <td>
        <div class="task-check ${t.status==='done'?'checked':''}" onclick="completeTask(${t.id})">
          ${t.status==='done'?'✓':''}
        </div>
      </td>
      <td style="${t.status==='done'?'text-decoration:line-through;color:var(--txt3)':''}">
        ${esc(t.title)}
      </td>
      <td>${t.deadline ? formatDate(t.deadline) : '—'}</td>
      <td><span class="p-badge ${t.priority_label}">${t.priority_label}</span></td>
      <td>
        <div class="action-btns">
          <button class="act-btn edit" onclick="openEditModal(${t.id})" title="რედაქტირება">✏️</button>
          <button class="act-btn del"  onclick="deleteTask(${t.id})"    title="წაშლა">🗑</button>
        </div>
      </td>
    </tr>`).join('');

  if (footer) footer.textContent = `Showing ${showing.length} of ${filtered.length} tasks`;
}

function filterTasks(type, btn) {
  currentFilter = type;
  document.querySelectorAll('.ftab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderDashTable();
}

// ── ALL TASKS (Tasks page) ───────────────────
function renderAllTasks() {
  const el = document.getElementById('all-tasks-list');
  if (!el) return;
  if (!allTasks.length) {
    el.innerHTML = '<div class="empty-small">task-ები ჯერ არ გაქვს. დაამატე ზემოდან!</div>';
    return;
  }
  el.innerHTML = allTasks.map(t => `
    <div class="task-row-full ${t.status==='done'?'done-row':''}">
      <div class="task-check ${t.status==='done'?'checked':''}" onclick="completeTask(${t.id})">
        ${t.status==='done'?'✓':''}
      </div>
      <div class="task-row-name">${esc(t.title)}</div>
      <div class="task-row-meta">
        <span class="task-row-cat">${esc(t.category)}</span>
        <span class="task-row-dl">${t.deadline ? formatDate(t.deadline) : ''}</span>
        <span class="p-badge ${t.priority_label}">${t.priority_label}</span>
      </div>
      <div class="action-btns">
        <button class="act-btn edit" onclick="openEditModal(${t.id})" title="რედაქტირება">✏️</button>
        <button class="act-btn del"  onclick="deleteTask(${t.id})"    title="წაშლა">🗑</button>
      </div>
    </div>`).join('');
}

// ── ADD TASK ─────────────────────────────────
async function submitTask() {
  const title    = document.getElementById('f-title').value.trim();
  const category = document.getElementById('f-category').value;
  const deadline = document.getElementById('f-deadline').value;
  const hours    = document.getElementById('f-hours').value;
  const msg      = document.getElementById('form-msg');
  if (!title) { showMsg(msg, 'task-ის სახელი სავალდებულოა!', 'err'); return; }
  try {
    const res  = await fetch('/api/add', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({title, category, deadline, estimated_hours: hours}),
    });
    const data = await res.json();
    if (data.error) { showMsg(msg, data.error, 'err'); return; }
    document.getElementById('f-title').value    = '';
    document.getElementById('f-deadline').value = '';
    showMsg(msg, `✓ "${title}" დაემატა · Priority: ${data.priority_label} (${data.priority_score})`, 'ok');
    await loadAll();
  } catch(e) { showMsg(msg, 'შეცდომა: ' + e.message, 'err'); }
}

// ── EDIT MODAL (UPDATE) ──────────────────────
function openEditModal(id) {
  const t = allTasks.find(x => x.id === id);
  if (!t) return;
  document.getElementById('edit-id').value       = t.id;
  document.getElementById('edit-title').value    = t.title;
  document.getElementById('edit-category').value = t.category;
  document.getElementById('edit-deadline').value = t.deadline || '';
  document.getElementById('edit-hours').value    = t.estimated_hours;
  document.getElementById('edit-modal').style.display = 'flex';
}

function closeEditModal() {
  document.getElementById('edit-modal').style.display = 'none';
  document.getElementById('edit-msg').textContent = '';
}

async function saveEdit() {
  const id       = document.getElementById('edit-id').value;
  const title    = document.getElementById('edit-title').value.trim();
  const category = document.getElementById('edit-category').value;
  const deadline = document.getElementById('edit-deadline').value;
  const hours    = document.getElementById('edit-hours').value;
  const msg      = document.getElementById('edit-msg');
  if (!title) { showMsg(msg, 'სახელი სავალდებულოა!', 'err'); return; }
  try {
    const res  = await fetch(`/api/update/${id}`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({title, category, deadline, estimated_hours: hours}),
    });
    const data = await res.json();
    if (data.error) { showMsg(msg, data.error, 'err'); return; }
    closeEditModal();
    await loadAll();
  } catch(e) { showMsg(msg, 'შეცდომა: ' + e.message, 'err'); }
}

// close modal on overlay click
document.addEventListener('click', e => {
  const modal = document.getElementById('edit-modal');
  if (e.target === modal) closeEditModal();
});

// ── COMPLETE ─────────────────────────────────
async function completeTask(id) {
  try {
    await fetch(`/api/complete/${id}`, {method:'POST'});
    await loadAll();
  } catch(e) { console.error(e); }
}

// ── DELETE ───────────────────────────────────
async function deleteTask(id) {
  if (!confirm('ნამდვილად წაშლა?')) return;
  try {
    await fetch(`/api/delete/${id}`, {method:'POST'});
    await loadAll();
  } catch(e) { console.error(e); }
}

// ── AI PLAN ──────────────────────────────────
async function loadAIPlan() {
  const el = document.getElementById('ai-plan-content');
  if (!el) return;
  el.innerHTML = '<div class="empty-small">იტვირთება...</div>';
  try {
    const res  = await fetch('/api/plan');
    const data = await res.json();
    if (!data.slots || !data.slots.length) {
      el.innerHTML = `<div class="plan-message">${data.message}</div>`;
      return;
    }
    el.innerHTML =
      data.slots.map(slot => `
        <div class="plan-slot">
          <div class="plan-slot-header">
            <span class="plan-slot-time">${slot.start} – ${slot.end}</span>
            <span class="plan-slot-label">${slot.label}</span>
          </div>
          ${slot.tasks.map(t => `<div class="plan-slot-task">📌 ${esc(t.title)}</div>`).join('')}
        </div>`).join('') +
      `<div class="plan-message">${data.message}</div>`;
  } catch(e) {
    el.innerHTML = '<div style="color:var(--high);font-size:12px">შეცდომა. სცადე ხელახლა.</div>';
  }
}

// ── FOCUS MODE ───────────────────────────────
function renderFocusTaskList() {
  const el = document.getElementById('focus-task-list');
  if (!el) return;
  const active = allTasks.filter(t => t.status === 'active');
  if (!active.length) {
    el.innerHTML = '<div class="empty-small">task-ები არ გაქვს</div>';
    return;
  }
  el.innerHTML = active.map(t => `
    <div class="focus-task-item ${focusTaskId===t.id?'active-focus':''}"
         onclick="selectFocusTask(${t.id},'${esc(t.title).replace(/'/g,"\\'")}')">
      <span class="p-badge ${t.priority_label}" style="font-size:10px">${t.priority_label}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}</span>
      <span class="focus-task-score">${t.priority_score}</span>
    </div>`).join('');
}

function selectFocusTask(id, title) {
  focusTaskId = id;
  resetFocus();
  const el = document.getElementById('focus-current-task');
  if (el) el.textContent = title;
  renderFocusTaskList();
}

function toggleFocus() {
  focusRunning ? pauseFocus() : startFocus();
}

function startFocus() {
  if (focusRemaining <= 0) return;
  focusRunning = true;
  const btn = document.getElementById('focus-start-btn');
  const lbl = document.getElementById('focus-label');
  if (btn) btn.textContent = '⏸ პაუზა';
  if (lbl) lbl.textContent = 'კონცენტრირებული სამუშაო';
  focusInterval = setInterval(() => {
    focusRemaining--;
    updateFocusDisplay();
    if (focusRemaining <= 0) {
      clearInterval(focusInterval);
      focusRunning = false;
      if (btn) btn.textContent = '▶ დაწყება';
      if (lbl) lbl.textContent = 'შესვენების დრო! 🎉';
    }
  }, 1000);
}

function pauseFocus() {
  clearInterval(focusInterval);
  focusRunning = false;
  const btn = document.getElementById('focus-start-btn');
  const lbl = document.getElementById('focus-label');
  if (btn) btn.textContent = '▶ გაგრძელება';
  if (lbl) lbl.textContent = 'პაუზაში...';
}

function resetFocus() {
  clearInterval(focusInterval);
  focusRunning   = false;
  focusRemaining = focusTotal;
  updateFocusDisplay();
  const btn = document.getElementById('focus-start-btn');
  const lbl = document.getElementById('focus-label');
  if (btn) btn.textContent = '▶ დაწყება';
  if (lbl) lbl.textContent = 'კონცენტრირებული სამუშაო';
}

function setPomMode(minutes, label, btn) {
  clearInterval(focusInterval);
  focusRunning   = false;
  focusTotal     = minutes * 60;
  focusRemaining = focusTotal;
  updateFocusDisplay();
  document.querySelectorAll('.ptab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const lbl = document.getElementById('focus-session-lbl');
  const startBtn = document.getElementById('focus-start-btn');
  if (lbl)     lbl.textContent     = label;
  if (startBtn) startBtn.textContent = '▶ დაწყება';
}

function updateFocusDisplay() {
  const m   = Math.floor(focusRemaining / 60);
  const s   = focusRemaining % 60;
  const str = pad(m) + ':' + pad(s);
  setText('focus-time', str);
  setText('mini-timer', str);

  const pct  = 1 - focusRemaining / focusTotal;
  const ring = document.getElementById('big-ring');
  const mini = document.getElementById('mini-ring');
  if (ring) ring.setAttribute('stroke-dashoffset', 552.9 * pct);
  if (mini) mini.setAttribute('stroke-dashoffset', 326.7 * pct);
}

// ── ANALYTICS ────────────────────────────────
async function renderAnalytics() {
  try {
    const res  = await fetch('/api/stats');
    const data = await res.json();
    renderStats(data);
    renderWeeklyChart(data.weekly, 'analytics-chart');
    renderPriorityBreakdown(data.priority);
  } catch(e) { console.error(e); }
}

function renderPriorityBreakdown(p) {
  const el = document.getElementById('analytics-priority');
  if (!el) return;
  const total = p.high + p.medium + p.low || 1;
  el.innerHTML = [
    { label:'High',   val:p.high,   color:'#e74c3c' },
    { label:'Medium', val:p.medium, color:'#f39c12' },
    { label:'Low',    val:p.low,    color:'#27ae60' },
  ].map(r => `
    <div class="pb-row">
      <span class="pb-label">${r.label}</span>
      <div class="pb-bar-wrap">
        <div class="pb-bar-fill" style="width:${Math.round(r.val/total*100)}%;background:${r.color}"></div>
      </div>
      <span class="pb-count">${r.val}</span>
    </div>`).join('');
}

// ── BOTTOM NAV (mobile) ──────────────────────
// auto-created for mobile in CSS via fixed bottom bar
// nav items trigger showPage() same as sidebar

// ── HELPERS ──────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function pad(n) { return String(n).padStart(2,'0'); }
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function formatDate(s) {
  if (!s) return '—';
  const [y,m,d] = s.split('-');
  return `${d} ${['იან','თებ','მარ','აპრ','მაი','ივნ','ივლ','აგვ','სექ','ოქტ','ნოე','დეკ'][+m-1]} ${y}`;
}
function daysLeft(deadline) {
  const now = new Date(); now.setHours(0,0,0,0);
  return Math.ceil((new Date(deadline) - now) / 86400000);
}
function showMsg(el, text, type) {
  if (!el) return;
  el.textContent = text;
  el.className = 'form-msg ' + type;
  setTimeout(() => { el.textContent = ''; el.className = 'form-msg'; }, 4000);
}
function cancelEdit() {}

// ── BOTTOM NAV ───────────────────────────────
function setBottomActive(el) {
  document.querySelectorAll('.bottom-nav-item').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

// ── GOALS (localStorage) ─────────────────────
function addGoal() {
  const title    = document.getElementById('g-title').value.trim();
  const category = document.getElementById('g-category').value;
  const deadline = document.getElementById('g-deadline').value;
  if (!title) return;
  const goals = JSON.parse(localStorage.getItem('fd_goals') || '[]');
  goals.unshift({ id: Date.now(), title, category, deadline, progress: 0 });
  localStorage.setItem('fd_goals', JSON.stringify(goals));
  document.getElementById('g-title').value    = '';
  document.getElementById('g-deadline').value = '';
  renderGoals();
}

function renderGoals() {
  const el    = document.getElementById('goals-list');
  if (!el) return;
  const goals = JSON.parse(localStorage.getItem('fd_goals') || '[]');
  if (!goals.length) return;
  const cards = goals.map(g => `
    <div class="goal-card">
      <div class="goal-title">${esc(g.title)}</div>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="range" min="0" max="100" value="${g.progress}"
          style="flex:1;accent-color:var(--accent)"
          onchange="updateGoalProgress(${g.id},this.value)">
        <span style="font-size:11px;color:var(--txt3);width:32px">${g.progress}%</span>
      </div>
      <div class="goal-progress-wrap"><div class="goal-progress-fill" style="width:${g.progress}%"></div></div>
      <div class="goal-meta">
        <span>${g.category}</span>
        <span>${g.deadline ? formatDate(g.deadline) : '—'}</span>
      </div>
    </div>`).join('');
  el.innerHTML = cards + '<button class="goal-add-btn" onclick="document.getElementById(\'g-title\').focus()">+ ახალი მიზანი</button>';
}

function updateGoalProgress(id, val) {
  const goals = JSON.parse(localStorage.getItem('fd_goals') || '[]');
  const g = goals.find(x => x.id === id);
  if (g) { g.progress = +val; localStorage.setItem('fd_goals', JSON.stringify(goals)); renderGoals(); }
}

// ── NOTES (localStorage) ─────────────────────
function addNote() {
  const title = document.getElementById('n-title').value.trim();
  const body  = document.getElementById('n-body').value.trim();
  const color = document.getElementById('n-color').value;
  if (!title && !body) return;
  const notes = JSON.parse(localStorage.getItem('fd_notes') || '[]');
  const months = ['იან','თებ','მარ','აპრ','მაი','ივნ','ივლ','აგვ','სექ','ოქტ','ნოე','დეკ'];
  const now = new Date();
  notes.unshift({ id: Date.now(), title, body, color, date: `${now.getDate()} ${months[now.getMonth()]}` });
  localStorage.setItem('fd_notes', JSON.stringify(notes));
  document.getElementById('n-title').value = '';
  document.getElementById('n-body').value  = '';
  renderNotes();
}

function renderNotes() {
  const el    = document.getElementById('notes-list');
  if (!el) return;
  const notes = JSON.parse(localStorage.getItem('fd_notes') || '[]');
  if (!notes.length) return;
  el.innerHTML = notes.map(n => `
    <div class="note-card ${n.color}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div class="note-title">${esc(n.title)}</div>
        <button onclick="deleteNote(${n.id})" style="background:none;border:none;color:var(--txt3);cursor:pointer;font-size:13px;padding:0">✕</button>
      </div>
      <div class="note-body">${esc(n.body)}</div>
      <div class="note-date">${n.date}</div>
    </div>`).join('');
}

function deleteNote(id) {
  const notes = JSON.parse(localStorage.getItem('fd_notes') || '[]').filter(n => n.id !== id);
  localStorage.setItem('fd_notes', JSON.stringify(notes));
  renderNotes();
}

// load saved goals/notes on page visit
const _origShow = showPage;
// already defined above — extend it
document.addEventListener('DOMContentLoaded', () => {
  renderGoals();
  renderNotes();
});
