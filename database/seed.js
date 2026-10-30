const bcrypt = require('bcrypt');
const db = require('./db');

const users = [
  {
    username: 'admin',
    name: 'Administrator',
    role: 'admin',
    password: 'Admin123!',
    device: 'DEV-ADMIN-001',
  },
  {
    username: 'dosen1',
    name: 'Dosen Informatika 1',
    role: 'dosen',
    password: 'Dosen123!',
    device: 'DEV-DOSEN-001',
  },
  {
    username: 'dosen2',
    name: 'Dosen Informatika 2',
    role: 'dosen',
    password: 'Dosen456!',
    device: 'DEV-DOSEN-002',
  },
  {
    username: 'mhs1',
    name: 'Mahasiswa 1',
    nim: '2024001',
    role: 'mahasiswa',
    password: 'Mhs123!',
    device: 'DEV-MHS-001',
  },
  {
    username: 'mhs2',
    name: 'Mahasiswa 2',
    nim: '2024002',
    role: 'mahasiswa',
    password: 'Mhs456!',
    device: 'DEV-MHS-002',
  },
  {
    username: 'mhs3',
    name: 'Mahasiswa 3',
    nim: '2024003',
    role: 'mahasiswa',
    password: 'Mhs789!',
    device: 'DEV-MHS-003',
  },
];

async function seed() {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const userIds = {};

    // 1. Membuat akun dan melakukan hashing password.
    for (const user of users) {
      const passwordHash = await bcrypt.hash(user.password, 12);

      await connection.execute(
        `INSERT INTO users
          (username, full_name, nim, role, password_hash)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          full_name = VALUES(full_name),
          nim = VALUES(nim),
          role = VALUES(role),
          password_hash = VALUES(password_hash)`,
        [user.username, user.name, user.nim || null, user.role, passwordHash]
      );

      const [rows] = await connection.execute(
        'SELECT id FROM users WHERE username = ?',
        [user.username]
      );

      userIds[user.username] = rows[0].id;
    }

    // 2. Mendaftarkan satu perangkat untuk setiap pengguna.
    for (const user of users) {
      await connection.execute(
        `INSERT INTO devices (user_id, device_id, is_active)
         VALUES (?, ?, TRUE)
         ON DUPLICATE KEY UPDATE is_active = TRUE`,
        [userIds[user.username], user.device]
      );
    }

    // 3. Membuat dua kelas dengan dosen berbeda.
    const classes = [
      {
        code: 'IF101',
        name: 'Algoritma dan Pemrograman',
        lecturer: userIds.dosen1,
      },
      {
        code: 'IF102',
        name: 'Basis Data',
        lecturer: userIds.dosen2,
      },
    ];

    const classIds = {};

    for (const item of classes) {
      await connection.execute(
        `INSERT INTO classes (class_code, course_name, lecturer_id)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
          course_name = VALUES(course_name),
          lecturer_id = VALUES(lecturer_id)`,
        [item.code, item.name, item.lecturer]
      );

      const [rows] = await connection.execute(
        'SELECT id FROM classes WHERE class_code = ?',
        [item.code]
      );

      classIds[item.code] = rows[0].id;
    }

    // 4. Mendaftarkan mahasiswa ke kedua kelas.
    const studentUsernames = ['mhs1', 'mhs2', 'mhs3'];

    for (const student of studentUsernames) {
      for (const classCode of ['IF101', 'IF102']) {
        const studentId = userIds[student];
        const classId = classIds[classCode];

        await connection.execute(
          `INSERT IGNORE INTO enrollments (class_id, student_id)
           VALUES (?, ?)`,
          [classId, studentId]
        );
      }
    }

    // 5. Membuat nilai awal yang belum difinalisasi.
    const scores = {
      mhs1: { IF101: 85, IF102: 80 },
      mhs2: { IF101: 90, IF102: 88 },
      mhs3: { IF101: 78, IF102: 82 },
    };

    for (const student of studentUsernames) {
      for (const classCode of ['IF101', 'IF102']) {
        await connection.execute(
          `INSERT IGNORE INTO grades
            (class_id, student_id, score, is_final)
           VALUES (?, ?, ?, FALSE)`,
          [
            classIds[classCode],
            userIds[student],
            scores[student][classCode],
          ]
        );
      }
    }

    await connection.commit();
    console.log('Seed berhasil!');
    console.log('6 pengguna, 6 perangkat, 2 kelas, dan 6 nilai awal diproses.');
  } catch (error) {
    await connection.rollback();
    console.error('Seed gagal:', error.message);
    process.exitCode = 1;
  } finally {
    connection.release();
    await db.end();
  }
}

seed();
