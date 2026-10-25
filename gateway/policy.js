
async function evaluatePolicy({ method, pathname, claims, db }) {
  const role = claims.role;
  const userId = Number(claims.sub);

  const deny = (reason, statusCode = 403) => ({
    allow: false,
    reason,
    statusCode,
  });

  const allow = (service, reason) => ({
    allow: true,
    service,
    reason,
  });

  // Sinkronisasi transkrip hanya untuk token service.
  if (method === 'POST' && pathname === '/transkrip/sinkron') {
    if (
      role === 'service' &&
      claims.sub === 'nilai-service'
    ) {
      return allow('transkrip', 'Token service valid');
    }

    return deny('Endpoint ini hanya untuk Service Nilai');
  }

  // Mahasiswa dan dosen boleh melihat nilai.
  // Service Nilai nantinya tetap wajib membatasi data
  // sesuai mahasiswa atau kelas yang diampu.
  if (method === 'GET' && pathname === '/nilai') {
    if (role === 'mahasiswa' || role === 'dosen') {
      return allow('nilai', 'Role diizinkan melihat nilai');
    }

    return deny('Role tidak diizinkan melihat nilai');
  }

  // Perubahan nilai oleh dosen.
  const updateMatch = pathname.match(/^\/nilai\/(\d+)$/);

  if (method === 'PUT' && updateMatch) {
    if (role !== 'dosen') {
      return deny('Hanya dosen yang boleh mengubah nilai');
    }

    if (!isWithinAccessHours()) {
      return deny('Di luar jam akses perubahan nilai');
    }

    const gradeId = Number(updateMatch[1]);

    const [rows] = await db.execute(
      `SELECT g.id
       FROM grades g
       JOIN classes c ON c.id = g.class_id
       WHERE g.id = ?
         AND c.lecturer_id = ?
         AND g.is_final = FALSE`,
      [gradeId, userId]
    );

    if (rows.length === 0) {
      return deny(
        'Nilai tidak ditemukan, sudah final, atau bukan kelas yang diampu'
      );
    }

    return allow('nilai', 'Dosen mengampu kelas dan nilai belum final');
  }

  // Finalisasi nilai per kelas.
  const finalizeMatch = pathname.match(
    /^\/kelas\/(\d+)\/finalisasi$/
  );

  if (method === 'POST' && finalizeMatch) {
    if (role !== 'dosen') {
      return deny('Hanya dosen yang boleh memfinalisasi nilai');
    }

    if (!isWithinAccessHours()) {
      return deny('Di luar jam akses finalisasi nilai');
    }

    const classId = Number(finalizeMatch[1]);

    const [rows] = await db.execute(
      `SELECT id FROM classes
       WHERE id = ? AND lecturer_id = ?`,
      [classId, userId]
    );

    if (rows.length === 0) {
      return deny('Kelas bukan kelas yang diampu dosen ini');
    }

    return allow('nilai', 'Dosen berhak memfinalisasi kelas');
  }

  // Melihat transkrip berdasarkan NIM.
  const transcriptMatch = pathname.match(
    /^\/transkrip\/([^/]+)$/
  );

  if (method === 'GET' && transcriptMatch) {
    const nim = transcriptMatch[1];

    if (role === 'admin') {
      return allow('transkrip', 'Admin boleh melihat semua transkrip');
    }

    if (role !== 'mahasiswa') {
      return deny('Role tidak diizinkan melihat transkrip');
    }

    const [rows] = await db.execute(
      `SELECT nim FROM users
       WHERE id = ? AND role = 'mahasiswa'`,
      [userId]
    );

    if (rows.length === 0 || rows[0].nim !== nim) {
      return deny('Mahasiswa hanya boleh melihat transkrip sendiri');
    }

    return allow('transkrip', 'NIM sesuai dengan pengguna');
  }

  return deny('Endpoint atau metode HTTP tidak diizinkan', 404);
}

function isWithinAccessHours() {
  const start = Number(process.env.ACCESS_START_HOUR ?? 7);
  const end = Number(process.env.ACCESS_END_HOUR ?? 21);
  const hour = new Date().getHours();

  return hour >= start && hour < end;
}

module.exports = { evaluatePolicy };
