# Panduan demo ZeroTrust Campus

## Persiapan

1. Jalankan MySQL dan pastikan database `zero_trust_db` tersedia.
2. Buat `.env` di folder proyek. Isi setidaknya `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `SERVICE_JWT_SECRET`, `GATEWAY_SECRET`, `SERVICE_CLIENT_ID`, dan `SERVICE_CLIENT_SECRET`. Gunakan secret yang berbeda untuk JWT, service JWT, gateway, dan client service.
3. Untuk database baru, jalankan `database/schema.sql`. Untuk database lama yang belum punya kolom NIM, jalankan `database/migrate-add-nim.sql` satu kali.
4. Dari PowerShell pada folder proyek, jalankan `npm run seed`.
5. Buka tiga terminal dari folder proyek dan jalankan:

   ```powershell
   npm run start:nilai
   ```

   ```powershell
   npm run start:transkrip
   ```

   ```powershell
   npm start
   ```

6. Buka `http://localhost:3000`.

## Akun seed

| Peran | Username | Password | ID perangkat |
| --- | --- | --- | --- |
| Admin | `admin` | `Admin123!` | `DEV-ADMIN-001` |
| Dosen IF101 | `dosen1` | `Dosen123!` | `DEV-DOSEN-001` |
| Dosen IF102 | `dosen2` | `Dosen456!` | `DEV-DOSEN-002` |
| Mahasiswa | `mhs1` | `Mhs123!` | `DEV-MHS-001` |

Gunakan hanya untuk demo lokal.

## Urutan demo praktikum

### 1. Gateway, login, JWT, dan device verification

Tunjukkan bahwa `http://localhost:3000/health` merespons. Di halaman login, masukkan akun dosen dengan ID perangkat mahasiswa `DEV-MHS-001`; login harus ditolak. Ulangi dengan `DEV-DOSEN-001`; login berhasil. Jelaskan bahwa Gateway memeriksa password dan perangkat sebelum menerbitkan access token JWT 10 menit serta refresh token 1 hari.

### 2. Hak akses mahasiswa dan dosen

Masuk sebagai `dosen1`, buka **Nilai**, lalu ubah salah satu nilai draft. Dosen ini hanya mendapat data kelas IF101. Masuk sebagai `mhs1`; mahasiswa hanya melihat nilai miliknya dan tidak mendapat kontrol untuk mengubah nilai.

Untuk mendemokan pembatasan jam dengan hasil yang konsisten, ubah sementara `ACCESS_START_HOUR=23` dan `ACCESS_END_HOUR=23` di `.env`, lalu restart Gateway dan Service Nilai. Coba simpan nilai sebagai dosen; Gateway harus menolak request karena di luar jam akses. Kembalikan ke `ACCESS_START_HOUR=7` dan `ACCESS_END_HOUR=21`, restart kedua layanan, lalu tunjukkan perubahan berhasil. Batas waktu mengikuti jam lokal mesin server.

### 3. Finalisasi nilai dan sinkronisasi transkrip

Masuk sebagai `dosen1`, pastikan jam akses sedang dibuka, lalu pilih **Finalisasi & sinkronkan** pada IF101. Konfirmasi aksi. Tunjukkan status nilai berubah menjadi final dan pesan jumlah rekaman yang disinkronkan.

Finalisasi memanggil Gateway untuk memperoleh token khusus service, lalu Service Nilai meminta sinkronisasi ke Service Transkrip melalui Gateway. Setelah itu, masuk sebagai admin dan cari NIM `2024001` di menu **Transkrip**. Nilai final IF101 harus muncul. Mahasiswa `mhs1` juga dapat melihat transkripnya sendiri; NIM di form dikunci ke identitas sesi.

### 4. Hak admin dan audit log

Masuk sebagai admin. Tunjukkan menu **Audit log** dan **Transkrip**. Audit log berisi keputusan `ALLOW` dan `DENY`, endpoint, subjek, perangkat, serta alasan yang disimpan backend. Logout, masuk sebagai dosen, lalu tunjukkan menu audit dan pencarian transkrip admin tidak tersedia untuk peran dosen.

### 5. Refresh token dan logout

Saat masih login, klik **Perbarui token**. Waktu kedaluwarsa access token berubah dan audit mencatat refresh yang berhasil. Lalu klik **Keluar**. Backend mencabut refresh token. Tunjukkan pencabutan di audit log admin atau jalankan query:

```sql
SELECT user_id, expires_at, revoked_at
FROM refresh_tokens
ORDER BY id DESC
LIMIT 5;
```

### 6. Verifikasi independen pada kedua service

Di PowerShell pada folder proyek, jalankan perintah ini. Perintah memuat `GATEWAY_SECRET` dari `.env`, tetapi memakai JWT palsu. Kedua service harus menolak request dengan status `401`, yang menunjukkan service memeriksa JWT secara independen setelah memeriksa rahasia Gateway.

```powershell
node -e "require('dotenv').config(); (async()=>{ for (const port of [3001,3002]) { const r=await fetch('http://127.0.0.1:'+port+'/health',{headers:{'X-Gateway-Secret':process.env.GATEWAY_SECRET,Authorization:'Bearer invalid-token'}}); console.log('Service',port,'HTTP',r.status,await r.text()); } })()"
```

Kemudian tunjukkan request **Nilai** atau **Transkrip** yang berhasil dari frontend. Gateway meneruskan request dengan bearer token dan `X-Gateway-Secret`; service memverifikasi keduanya kembali sebelum memberi data.

## Catatan

- Audit log dibaca melalui endpoint Gateway khusus admin, bukan jejak lokal browser.
- Finalisasi mengunci nilai sebelum sinkronisasi dimulai. Jika service transkrip gagal, nilai tetap final; tombol **Sinkronkan ulang transkrip** dapat dipakai setelah layanan pulih.
- Akun seed dan secret di `.env` hanya untuk demo lokal, jangan dipakai untuk deployment produksi.
