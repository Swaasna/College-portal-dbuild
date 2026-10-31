# Campus Hub (College Management Portal) - DBuild
Node.js + Express backend, remote MySQL, plain HTML/JS frontend.

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the REMOTE MySQL details (host, port, user, password, database)
3. `npm start` then open http://localhost:3000

Tables (students, courses, attendance, notices) and sample rows are created automatically.

CRUD: students / courses / notices have GET, POST, PUT, DELETE at /api/<name>.
Attendance: GET, POST /bulk (insert or update), DELETE at /api/attendance.
