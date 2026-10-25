
const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
const crypto = require('crypto');
const db = require('../database/db');

require('dotenv').config({
  path: path.resolve(__dirname, '../.env'),
});

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT_TRANSKRIP || 3002);

// Memastikan request melewati API Gateway.
function validGatewaySecret(provided) {
  const expected = process.env.GATEWAY_SECRET;

  if (!expected || !provided) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);

  return a.length === b.length &&
    crypto.timingSafeEqual(a, b);
}

// Verifikasi gateway secret dan JWT secara independen.
app.use((req, res, next) => {
  if (!validGatewaySecret(req.get('X-Gateway-Secret'))) {
    return res.status(403).json({
      error: 'Gateway secret tidak valid',
    });
  }

  const isSync =
    req.method === 'POST' &&
    req.path === '/transkrip/sinkron';

  const authorization = req.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({
      error: 'Bearer token wajib disertakan',
    });
  }

  const secret = isSync
    ? process.env.SERVICE_JWT_SECRET
    : process.env.JWT_SECRET;

  try {
    req.claims = jwt.verify(match[1], secret);

    if (isSync) {
      if (
        req.claims.role !== 'service' ||
        req.claims.sub !== 'nilai-service'
      ) {
        return res.status(403).json({
          error: 'Sinkronisasi hanya boleh dilakukan Service Nilai',
        });
      }
    } else {
      const userId = Number(req.claims.sub);

      if (
        !['admin', 'mahasiswa'].includes(req.claims.role) ||
        !Number.isInteger(userId) ||
        userId <= 0
      ) {
        return res.status(403).json({
          error: 'Role tidak diizinkan di Service Transkrip',
        });
      }
    }

    next();
  } catch (error) {
    return res.status(401).json({
      error: 'Token tidak valid atau kedaluwarsa',
    });
  }
});

// Mahasiswa melihat transkrip miliknya sendiri.
// Admin dapat melihat transkrip mahasiswa mana pun.
app.get('/transkrip/:nim', async (req, res) => {
  try {
    const nim = req.params.nim;
    const userId = Number(req.claims.sub);

    const [students] = await db.execute(
      `SELECT id, nim, full_name
       FROM users
       WHERE nim = ? AND role = 'mahasiswa'`,
      [nim]
    );

    if (students.length === 0) {
      return res.status(404).json({
        error: 'Mahasiswa dengan NIM tersebut tidak ditemukan',
      });
    }

    const student = students[0];

    if (
      req.claims.role === 'mahasiswa' &&
      student.id !== userId
    ) {
      return res.status(403).json({
        error: 'Mahasiswa hanya boleh melihat transkrip sendiri',
      });
    }

    const [rows] = await db.execute(
      `SELECT
         t.student_id,
         u.nim,
         u.full_name,
         c.class_code,
         c.course_name,
         t.score,
         t.synced_at
       FROM transcripts t
       JOIN users u ON u.id = t.student_id
       JOIN classes c ON c.id = t.class_id
       WHERE t.student_id = ?
       ORDER BY c.class_code`,
      [student.id]
    );

    return res.json({
      student: {
        nim: student.nim,
        name: student.full_name,
      },
      data: rows,
    });
  } catch (error) {
    console.error('GET transkrip:', error.message);

    return res.status(500).json({
      error: 'Gagal mengambil data transkrip',
    });
  }
});

// Hanya token service yang valid boleh menyinkronkan nilai final.
app.post('/transkrip/sinkron', async (req, res) => {
  const classId = Number(req.body?.classId);

  if (!Number.isInteger(classId) || classId <= 0) {
    return res.status(400).json({
      error: 'classId wajib berupa angka positif',
    });
  }

  try {
    const [grades] = await db.execute(
      `SELECT student_id, score
       FROM grades
       WHERE class_id = ?
         AND is_final = TRUE
         AND score IS NOT NULL`,
      [classId]
    );

    if (grades.length === 0) {
      return res.status(409).json({
        error: 'Tidak ada nilai final yang dapat disinkronkan',
      });
    }

    await db.execute(
      `INSERT INTO transcripts
         (student_id, class_id, score, synced_at)
       SELECT student_id, class_id, score, CURRENT_TIMESTAMP
       FROM grades
       WHERE class_id = ?
         AND is_final = TRUE
         AND score IS NOT NULL
       ON DUPLICATE KEY UPDATE
         score = VALUES(score),
         synced_at = CURRENT_TIMESTAMP`,
      [classId]
    );

    return res.json({
      message: 'Sinkronisasi transkrip berhasil',
      classId,
      syncedRecords: grades.length,
    });
  } catch (error) {
    console.error('POST sinkron:', error.message);

    return res.status(500).json({
      error: 'Gagal menyinkronkan transkrip',
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `Service Transkrip berjalan di http://localhost:${PORT}`
  );
});
