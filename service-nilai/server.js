
const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('../database/db');

require('dotenv').config({
  path: path.resolve(__dirname, '../.env'),
});

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT_NILAI || 3001);

function withinAccessHours() {
  const start = Number(process.env.ACCESS_START_HOUR ?? 7);
  const end = Number(process.env.ACCESS_END_HOUR ?? 21);
  const hour = new Date().getHours();
  return hour >= start && hour < end;
}

// Verifikasi independen di Service Nilai.
app.use((req, res, next) => {
  const expected = process.env.GATEWAY_SECRET;
  const provided = req.get('X-Gateway-Secret');

  if (!expected || !provided || provided !== expected) {
    return res.status(403).json({
      error: 'Gateway secret tidak valid',
    });
  }

  const authorization = req.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({
      error: 'Bearer token wajib disertakan',
    });
  }

  try {
    req.claims = jwt.verify(match[1], process.env.JWT_SECRET);

    if (
      !['mahasiswa', 'dosen'].includes(req.claims.role) ||
      !Number.isInteger(Number(req.claims.sub)) ||
      Number(req.claims.sub) <= 0
    ) {
      return res.status(403).json({
        error: 'Role tidak diizinkan di Service Nilai',
      });
    }

    next();
  } catch (error) {
    return res.status(401).json({
      error: 'Token tidak valid atau kedaluwarsa',
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Service Nilai' });
});

// Mahasiswa hanya melihat nilainya sendiri.
// Dosen hanya melihat nilai di kelas yang diampu.
app.get('/nilai', async (req, res) => {
  try {
    const userId = Number(req.claims.sub);
    let rows;

    if (req.claims.role === 'mahasiswa') {
      [rows] = await db.execute(
        `SELECT g.id, c.class_code, c.course_name,
                g.score, g.is_final
         FROM grades g
         JOIN classes c ON c.id = g.class_id
         WHERE g.student_id = ?
         ORDER BY c.class_code`,
        [userId]
      );
    } else {
      [rows] = await db.execute(
        `SELECT g.id, c.class_code, c.course_name,
                g.student_id, g.score, g.is_final
         FROM grades g
         JOIN classes c ON c.id = g.class_id
         WHERE c.lecturer_id = ?
         ORDER BY c.class_code, g.student_id`,
        [userId]
      );
    }

    res.json({ data: rows });
  } catch (error) {
    console.error('GET nilai:', error.message);
    res.status(500).json({ error: 'Gagal mengambil data nilai' });
  }
});

// Dosen hanya boleh mengubah nilai di kelasnya,
// sebelum nilai difinalisasi dan pada jam akses.
app.put('/nilai/:id', async (req, res) => {
  if (req.claims.role !== 'dosen') {
    return res.status(403).json({
      error: 'Hanya dosen yang boleh mengubah nilai',
    });
  }

  const score = req.body?.score;
  const gradeId = Number(req.params.id);

  if (
    !Number.isInteger(gradeId) ||
    gradeId <= 0 ||
    typeof score !== 'number' ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > 100
  ) {
    return res.status(400).json({
      error: 'ID nilai atau skor tidak valid (skor 0–100)',
    });
  }

  if (!withinAccessHours()) {
    return res.status(403).json({
      error: 'Perubahan nilai hanya diizinkan pukul 07.00–21.00',
    });
  }

  try {
    const userId = Number(req.claims.sub);

    const [result] = await db.execute(
      `UPDATE grades g
       JOIN classes c ON c.id = g.class_id
       SET g.score = ?, g.updated_by = ?
       WHERE g.id = ?
         AND c.lecturer_id = ?
         AND g.is_final = FALSE`,
      [score, userId, gradeId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(403).json({
        error: 'Nilai tidak ditemukan, sudah final, atau bukan kelas yang diampu',
      });
    }

    res.json({
      message: 'Nilai berhasil diperbarui',
      gradeId,
      score,
    });
  } catch (error) {
    console.error('PUT nilai:', error.message);
    res.status(500).json({ error: 'Gagal memperbarui nilai' });
  }
});

// Finalisasi nilai sekaligus meminta sinkronisasi transkrip
// melalui Gateway dengan token service khusus.
app.post('/kelas/:id/finalisasi', async (req, res) => {
  if (req.claims.role !== 'dosen') {
    return res.status(403).json({
      error: 'Hanya dosen yang boleh memfinalisasi nilai',
    });
  }

  const classId = Number(req.params.id);

  if (!Number.isInteger(classId) || classId <= 0) {
    return res.status(400).json({ error: 'ID kelas tidak valid' });
  }

  if (!withinAccessHours()) {
    return res.status(403).json({
      error: 'Finalisasi hanya diizinkan pukul 07.00–21.00',
    });
  }

  try {
    const userId = Number(req.claims.sub);

    const [classes] = await db.execute(
      `SELECT id FROM classes
       WHERE id = ? AND lecturer_id = ?`,
      [classId, userId]
    );

    if (classes.length === 0) {
      return res.status(403).json({
        error: 'Kelas bukan kelas yang diampu dosen ini',
      });
    }

    const [grades] = await db.execute(
      `SELECT id FROM grades WHERE class_id = ?`,
      [classId]
    );

    if (grades.length === 0) {
      return res.status(400).json({
        error: 'Tidak ada nilai untuk difinalisasi',
      });
    }

    const [result] = await db.execute(
      `UPDATE grades SET is_final = TRUE
       WHERE class_id = ? AND is_final = FALSE`,
      [classId]
    );

    // Minta token khusus untuk komunikasi antarlayanan.
    const tokenResponse = await fetch(
      'http://127.0.0.1:3000/auth/service',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: process.env.SERVICE_CLIENT_ID,
          clientSecret: process.env.SERVICE_CLIENT_SECRET,
        }),
      }
    );

    if (!tokenResponse.ok) {
      return res.status(502).json({
        error: 'Nilai telah difinalisasi, tetapi token service gagal diperoleh',
      });
    }

    const tokenData = await tokenResponse.json();

    // Request sinkronisasi harus melewati Gateway.
    const syncResponse = await fetch(
      'http://127.0.0.1:3000/transkrip/sinkron',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.accessToken}`,
          'X-Gateway-Secret': process.env.GATEWAY_SECRET,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ classId }),
      }
    );

    if (!syncResponse.ok) {
      return res.status(502).json({
        message: 'Nilai telah difinalisasi, tetapi sinkronisasi transkrip gagal',
        finalized: true,
      });
    }

    const syncData = await syncResponse.json();

    res.json({
      message: 'Finalisasi dan sinkronisasi berhasil',
      classId,
      newlyFinalized: result.affectedRows,
      transcript: syncData,
    });
  } catch (error) {
    console.error('Finalisasi:', error.message);
    res.status(500).json({
      error: 'Terjadi kesalahan saat finalisasi nilai',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Service Nilai berjalan di http://localhost:${PORT}`);
});
