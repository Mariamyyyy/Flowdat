from flask import Flask, render_template, request, jsonify, redirect, url_for, session
import sqlite3
import os
import hashlib
import secrets
from datetime import datetime, date
from functools import wraps

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)
DATABASE = os.path.join(os.path.dirname(__file__), 'database', 'tasks.db')


# ── DB ──────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            email      TEXT NOT NULL UNIQUE,
            password   TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            title           TEXT NOT NULL,
            category        TEXT DEFAULT 'სხვა',
            deadline        TEXT,
            estimated_hours REAL DEFAULT 1.0,
            priority_score  INTEGER DEFAULT 50,
            priority_label  TEXT DEFAULT 'Medium',
            status          TEXT DEFAULT 'active',
            created_at      TEXT DEFAULT (datetime('now')),
            completed_at    TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS daily_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id     INTEGER,
            user_id     INTEGER,
            log_date    TEXT,
            action      TEXT,
            hour_of_day INTEGER
        );
    ''')
    conn.commit()
    conn.close()


# ── HELPERS ─────────────────────────────────────
def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated

def calculate_priority(deadline, estimated_hours, category):
    estimated_hours = float(estimated_hours)
    score = 40
    if deadline:
        try:
            dl = datetime.strptime(deadline, '%Y-%m-%d').date()
            days_left = (dl - date.today()).days
            if days_left < 0:    score += 60
            elif days_left == 0: score += 55
            elif days_left <= 2: score += 45
            elif days_left <= 7: score += 30
            elif days_left <= 14:score += 15
            else:                score += 5
        except ValueError:
            pass
    weights = {'სამუშაო':1.3,'სწავლა':1.2,'ჯანმრთელობა':1.2,'პირადი':0.9,'სხვა':1.0}
    score = int(score * weights.get(category, 1.0))
    if estimated_hours >= 4:   score += 10
    elif estimated_hours >= 2: score += 5
    score = max(0, min(100, score))
    label = 'High' if score >= 70 else ('Medium' if score >= 40 else 'Low')
    return score, label

def generate_daily_plan(tasks):
    if not tasks:
        return {'slots': [], 'message': 'დღეს task-ები არ გაქვს!'}
    sorted_tasks = sorted(tasks, key=lambda t: t['priority_score'], reverse=True)
    slots_config = [
        {'start':'09:00','end':'12:00','capacity':3.0,'label':'დილის პიკი'},
        {'start':'14:00','end':'16:00','capacity':2.0,'label':'შუადღე'},
        {'start':'16:00','end':'18:00','capacity':2.0,'label':'საღამო'},
    ]
    plan, used = [], set()
    for slot in slots_config:
        slot_tasks, remaining = [], slot['capacity']
        for t in sorted_tasks:
            if t['id'] in used: continue
            h = t.get('estimated_hours', 1.0)
            if h <= remaining + 0.5:
                slot_tasks.append(t); used.add(t['id']); remaining -= h
        if slot_tasks:
            plan.append({**slot, 'tasks': slot_tasks})
    left = len(sorted_tasks) - len(used)
    msg = f"დღეს {len(used)} task შეასრულე."
    if left > 0: msg += f" კიდევ {left} ხვალისთვის გადადე."
    return {'slots': plan, 'message': msg}


# ══════════════════════════════════════════════
# PUBLIC ROUTES
# ══════════════════════════════════════════════

@app.route('/')
def landing():
    if 'user_id' in session:
        return redirect(url_for('dashboard'))
    return render_template('landing.html')


@app.route('/register', methods=['GET','POST'])
def register():
    if 'user_id' in session:
        return redirect(url_for('dashboard'))
    error = None
    if request.method == 'POST':
        name     = request.form.get('name','').strip()
        email    = request.form.get('email','').strip().lower()
        password = request.form.get('password','')
        confirm  = request.form.get('confirm','')
        if not name or not email or not password:
            error = 'ყველა ველი სავალდებულოა'
        elif password != confirm:
            error = 'პაროლები არ ემთხვევა'
        elif len(password) < 6:
            error = 'პაროლი მინიმუმ 6 სიმბოლო უნდა იყოს'
        else:
            conn = get_db()
            existing = conn.execute('SELECT id FROM users WHERE email=?',(email,)).fetchone()
            if existing:
                error = 'ეს ელ-ფოსტა უკვე რეგისტრირებულია'
            else:
                conn.execute(
                    'INSERT INTO users (name,email,password) VALUES (?,?,?)',
                    (name, email, hash_password(password))
                )
                conn.commit()
                user = conn.execute('SELECT * FROM users WHERE email=?',(email,)).fetchone()
                session['user_id']   = user['id']
                session['user_name'] = user['name']
                conn.close()
                return redirect(url_for('dashboard'))
            conn.close()
    return render_template('register.html', error=error)


@app.route('/login', methods=['GET','POST'])
def login():
    if 'user_id' in session:
        return redirect(url_for('dashboard'))
    error = None
    if request.method == 'POST':
        email    = request.form.get('email','').strip().lower()
        password = request.form.get('password','')
        conn = get_db()
        user = conn.execute(
            'SELECT * FROM users WHERE email=? AND password=?',
            (email, hash_password(password))
        ).fetchone()
        conn.close()
        if user:
            session['user_id']   = user['id']
            session['user_name'] = user['name']
            return redirect(url_for('dashboard'))
        else:
            error = 'ელ-ფოსტა ან პაროლი არასწორია'
    return render_template('login.html', error=error)


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('landing'))


# ══════════════════════════════════════════════
# PROTECTED ROUTES
# ══════════════════════════════════════════════

@app.route('/dashboard')
@login_required
def dashboard():
    return render_template('index.html', user_name=session.get('user_name',''))


@app.route('/api/tasks')
@login_required
def api_tasks():
    conn  = get_db()
    tasks = conn.execute(
        "SELECT * FROM tasks WHERE status='active' AND user_id=? ORDER BY priority_score DESC",
        (session['user_id'],)
    ).fetchall()
    conn.close()
    return jsonify([dict(t) for t in tasks])


@app.route('/api/stats')
@login_required
def api_stats():
    uid  = session['user_id']
    conn = get_db()
    total      = conn.execute("SELECT COUNT(*) FROM tasks WHERE user_id=?", (uid,)).fetchone()[0]
    completed  = conn.execute("SELECT COUNT(*) FROM tasks WHERE user_id=? AND status='done'", (uid,)).fetchone()[0]
    active     = conn.execute("SELECT COUNT(*) FROM tasks WHERE user_id=? AND status='active'", (uid,)).fetchone()[0]
    done_month = conn.execute(
        "SELECT COUNT(*) FROM tasks WHERE user_id=? AND status='done' AND strftime('%Y-%m',completed_at)=strftime('%Y-%m','now')",
        (uid,)
    ).fetchone()[0]
    rate   = round(completed/total*100) if total > 0 else 0
    high   = conn.execute("SELECT COUNT(*) FROM tasks WHERE user_id=? AND priority_label='High'   AND status='active'",(uid,)).fetchone()[0]
    medium = conn.execute("SELECT COUNT(*) FROM tasks WHERE user_id=? AND priority_label='Medium' AND status='active'",(uid,)).fetchone()[0]
    low    = conn.execute("SELECT COUNT(*) FROM tasks WHERE user_id=? AND priority_label='Low'    AND status='active'",(uid,)).fetchone()[0]
    upcoming = conn.execute(
        "SELECT title,deadline,priority_label FROM tasks WHERE user_id=? AND status='active' AND deadline!='' AND deadline IS NOT NULL ORDER BY deadline ASC LIMIT 5",
        (uid,)
    ).fetchall()
    weekly = conn.execute(
        "SELECT DATE(completed_at) as d, COUNT(*) as cnt FROM tasks WHERE user_id=? AND status='done' AND completed_at>=DATE('now','-6 days') GROUP BY d ORDER BY d",
        (uid,)
    ).fetchall()
    conn.close()
    return jsonify({
        'total':total,'completed':completed,'in_progress':active,
        'done_month':done_month,'completion_rate':rate,
        'priority':{'high':high,'medium':medium,'low':low},
        'upcoming':[dict(u) for u in upcoming],
        'weekly':[dict(w) for w in weekly],
    })


@app.route('/api/add', methods=['POST'])
@login_required
def api_add():
    d        = request.get_json()
    title    = d.get('title','').strip()
    category = d.get('category','სხვა')
    deadline = d.get('deadline','')
    hours    = float(d.get('estimated_hours',1.0))
    if not title:
        return jsonify({'error':'სათაური სავალდებულოა'}), 400
    score, label = calculate_priority(deadline, hours, category)
    conn = get_db()
    cur  = conn.execute(
        "INSERT INTO tasks (user_id,title,category,deadline,estimated_hours,priority_score,priority_label) VALUES (?,?,?,?,?,?,?)",
        (session['user_id'], title, category, deadline, hours, score, label)
    )
    task_id = cur.lastrowid
    conn.commit()
    task = dict(conn.execute("SELECT * FROM tasks WHERE id=?",(task_id,)).fetchone())
    conn.close()
    return jsonify(task)


@app.route('/api/update/<int:task_id>', methods=['POST'])
@login_required
def api_update(task_id):
    d        = request.get_json()
    title    = d.get('title','').strip()
    category = d.get('category','სხვა')
    deadline = d.get('deadline','')
    hours    = float(d.get('estimated_hours',1.0))
    if not title:
        return jsonify({'error':'სათაური სავალდებულოა'}), 400
    score, label = calculate_priority(deadline, hours, category)
    conn = get_db()
    conn.execute(
        "UPDATE tasks SET title=?,category=?,deadline=?,estimated_hours=?,priority_score=?,priority_label=? WHERE id=? AND user_id=?",
        (title, category, deadline, hours, score, label, task_id, session['user_id'])
    )
    conn.commit()
    task = dict(conn.execute("SELECT * FROM tasks WHERE id=?",(task_id,)).fetchone())
    conn.close()
    return jsonify(task)


@app.route('/api/complete/<int:task_id>', methods=['POST'])
@login_required
def api_complete(task_id):
    conn = get_db()
    conn.execute(
        "UPDATE tasks SET status='done', completed_at=datetime('now') WHERE id=? AND user_id=?",
        (task_id, session['user_id'])
    )
    conn.execute(
        "INSERT INTO daily_log (task_id,user_id,log_date,action,hour_of_day) VALUES (?,?,DATE('now'),'complete',?)",
        (task_id, session['user_id'], datetime.now().hour)
    )
    conn.commit()
    conn.close()
    return jsonify({'success':True})


@app.route('/api/delete/<int:task_id>', methods=['POST'])
@login_required
def api_delete(task_id):
    conn = get_db()
    conn.execute("DELETE FROM tasks WHERE id=? AND user_id=?", (task_id, session['user_id']))
    conn.commit()
    conn.close()
    return jsonify({'success':True})


@app.route('/api/plan')
@login_required
def api_plan():
    conn  = get_db()
    tasks = [dict(t) for t in conn.execute(
        "SELECT * FROM tasks WHERE user_id=? AND status='active' ORDER BY priority_score DESC",
        (session['user_id'],)
    ).fetchall()]
    conn.close()
    return jsonify(generate_daily_plan(tasks))


if __name__ == '__main__':
    init_db()
    print("\n✅ FlowDay გაეშვა!  →  http://127.0.0.1:5000\n")
    app.run(debug=True)
