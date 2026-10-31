require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
  waitForConnections: true,
  connectionLimit: 5,
  multipleStatements: true,
});

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    if (e.code === 'ER_DUP_ENTRY') e = bad('That roll number / course code already exists', 409);
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error: ' + e.message });
  });

app.get('/api/health', wrap(async (req, res) => {
  const [[r]] = await pool.query('SELECT NOW() AS now, DATABASE() AS db');
  res.json({ ok: true, db_host: process.env.DB_HOST, database: r.db, server_time: r.now });
}));

// Generic CRUD for simple tables. fields: { column: 'str' | 'int' | 'opt' }
function crud(route, table, fields, order) {
  const clean = (b) => {
    const o = {};
    for (const [k, t] of Object.entries(fields)) {
      let v = b[k];
      if (t === 'int') { v = Number(v); if (!Number.isInteger(v) || v < 0) throw bad(`${k} must be a whole number`); }
      else { v = String(v ?? '').trim(); if (!v && t === 'str') throw bad(`${k} is required`); if (!v) v = null; }
      o[k] = v;
    }
    return o;
  };
  app.get(`/api/${route}`, wrap(async (req, res) => {
    const [rows] = await pool.query(`SELECT * FROM ${table} ORDER BY ${order}`);
    res.json(rows);
  }));
  app.post(`/api/${route}`, wrap(async (req, res) => {
    const [r] = await pool.query(`INSERT INTO ${table} SET ?`, [clean(req.body)]);
    res.status(201).json({ id: r.insertId });
  }));
  app.put(`/api/${route}/:id`, wrap(async (req, res) => {
    const [r] = await pool.query(`UPDATE ${table} SET ? WHERE id=?`, [clean(req.body), req.params.id]);
    if (!r.affectedRows) throw bad('Not found', 404);
    res.json({ updated: true });
  }));
  app.delete(`/api/${route}/:id`, wrap(async (req, res) => {
    const [r] = await pool.query(`DELETE FROM ${table} WHERE id=?`, [req.params.id]);
    if (!r.affectedRows) throw bad('Not found', 404);
    res.json({ deleted: true });
  }));
}
crud('students', 'students', { roll_no: 'str', name: 'str', department: 'str', year: 'int', email: 'opt' }, 'roll_no');
crud('courses', 'courses', { code: 'str', title: 'str', faculty: 'str', credits: 'int' }, 'code');
crud('notices', 'notices', { title: 'str', body: 'str' }, 'created_at DESC, id DESC');

// Attendance: read a class-day, save (insert or update) a class-day, clear a class-day
app.get('/api/attendance', wrap(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT student_id, status FROM attendance WHERE course_id=? AND att_date=?', [req.query.course_id, req.query.date]);
  res.json(rows);
}));
app.post('/api/attendance/bulk', wrap(async (req, res) => {
  const { course_id, date, records } = req.body;
  if (!course_id || !date || !Array.isArray(records) || !records.length) throw bad('Choose a course, date and students');
  const vals = records.map((r) => [r.student_id, course_id, date, r.status === 'Absent' ? 'Absent' : 'Present']);
  await pool.query(
    'INSERT INTO attendance (student_id, course_id, att_date, status) VALUES ? ON DUPLICATE KEY UPDATE status=VALUES(status)', [vals]);
  res.json({ saved: vals.length });
}));
app.delete('/api/attendance', wrap(async (req, res) => {
  const [r] = await pool.query('DELETE FROM attendance WHERE course_id=? AND att_date=?', [req.query.course_id, req.query.date]);
  res.json({ deleted: r.affectedRows });
}));
app.get('/api/attendance/summary', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT s.id, s.roll_no, s.name, COUNT(a.id) AS total, COALESCE(SUM(a.status='Present'),0) AS present
     FROM students s LEFT JOIN attendance a ON a.student_id = s.id GROUP BY s.id ORDER BY s.roll_no`);
  res.json(rows.map((r) => ({ ...r, total: Number(r.total), present: Number(r.present) })));
}));

async function init() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const [[c]] = await pool.query('SELECT COUNT(*) AS n FROM students');
  if (c.n === 0) {
    await pool.query('INSERT INTO students (roll_no,name,department,year,email) VALUES ?', [[
      ['21CS001', 'Ananya R', 'CSE', 3, 'ananya@example.com'],
      ['21CS002', 'Karthik S', 'CSE', 3, null],
      ['21EC014', 'Meena P', 'ECE', 2, null]]]);
    await pool.query('INSERT INTO courses (code,title,faculty,credits) VALUES ?', [[
      ['CS3301', 'Database Management Systems', 'Dr. Lakshmi', 4],
      ['CS3302', 'Operating Systems', 'Prof. Raman', 3]]]);
    await pool.query('INSERT INTO notices (title,body) VALUES (?,?)',
      ['Welcome', 'Internal tests begin next month. Check the notice board for the timetable.']);
  }
}
const PORT = process.env.PORT || 3000;
init().then(() => app.listen(PORT, () => console.log('College portal running on port ' + PORT)))
  .catch((e) => { console.error('Could not connect to the database:', e.message); process.exit(1); });
