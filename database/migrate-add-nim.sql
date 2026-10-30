USE zero_trust_db;

-- Jalankan satu kali pada database yang sudah dibuat sebelum kolom NIM tersedia.
ALTER TABLE users ADD COLUMN nim VARCHAR(30) NULL UNIQUE AFTER full_name;

-- NIM contoh ini hanya untuk akun seed lokal.
UPDATE users SET nim = '2024001' WHERE username = 'mhs1' AND nim IS NULL;
UPDATE users SET nim = '2024002' WHERE username = 'mhs2' AND nim IS NULL;
UPDATE users SET nim = '2024003' WHERE username = 'mhs3' AND nim IS NULL;
