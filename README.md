# 🛡️ ZeroTrust Campus — Academic Access Console

> **Never trust. Always verify.**
> Sistem informasi akademik berbasis arsitektur **Zero Trust Security** yang memverifikasi identitas, perangkat, peran, dan konteks pada setiap permintaan — tanpa terkecuali.

---

## 📋 Daftar Isi

- [Tentang Proyek](#tentang-proyek)
- [Arsitektur](#arsitektur)
- [Fitur Utama](#fitur-utama)
- [Tech Stack](#tech-stack)
- [Prasyarat](#prasyarat)
- [Instalasi & Konfigurasi](#instalasi--konfigurasi)
- [Menjalankan Aplikasi](#menjalankan-aplikasi)
- [Struktur Proyek](#struktur-proyek)
- [Alur Keamanan Zero Trust](#alur-keamanan-zero-trust)
- [API Endpoints](#api-endpoints)
- [Skema Database](#skema-database)
- [Akun Demo](#akun-demo)
- [Lisensi](#lisensi)

---

## Tentang Proyek

**ZeroTrust Campus** adalah sistem informasi akademik yang dibangun dengan prinsip *Zero Trust Security*. Sistem ini mengelola data nilai dan transkrip mahasiswa melalui arsitektur **microservices** dengan satu API Gateway sebagai *Policy Enforcement Point* (PEP).

Setiap request — termasuk dari internal service — harus melewati proses verifikasi:

1. **Identitas** — JWT yang ditandatangani & diverifikasi
2. **Perangkat** — Device ID yang terdaftar pada akun pengguna
3. **Kebijakan** — Role-Based Access Control (RBAC) + kepemilikan data + jam akses
4. **Audit** — Setiap keputusan (allow/deny) dicatat ke database

---

## Arsitektur

```
┌─────────────────────────────────────────────────────────┐
│                      Frontend (SPA)                     │
│              HTML + CSS + Vanilla JavaScript             │
└─────────────────┬───────────────────────────────────────┘
                  │ HTTP (Bearer JWT + X-Device-ID)
                  ▼
┌─────────────────────────────────────────────────────────┐
│                  API Gateway (:3000)                     │
│  ┌────────────┐  ┌───────────────┐  ┌───────────────┐  │
│  │   Auth      │  │ Policy Engine │  │  Audit Logger │  │
│  │  (Login,    │  │ (evaluatePolicy)│ │  (audit_logs) │  │
│  │  Refresh,   │  │               │  │               │  │
│  │  Logout)    │  └───────┬───────┘  └───────────────┘  │
│  └────────────┘          │                              │
└──────────────────────────┼──────────────────────────────┘
                           │  X-Gateway-Secret + Bearer JWT
              ┌────────────┴────────────┐
              ▼                         ▼
┌─────────────────────┐   ┌─────────────────────────┐
│  Service Nilai      │   │  Service Transkrip       │
│  (:3001)            │──▶│  (:3002)                 │
│                     │   │                          │
│  • GET /nilai       │   │  • GET /transkrip/:nim   │
│  • PUT /nilai/:id   │   │  • POST /transkrip/sinkron│
│  • POST /kelas/:id  │   │                          │
│    /finalisasi      │   │                          │
└─────────┬───────────┘   └──────────┬──────────────┘
          │                          │
          └──────────┬───────────────┘
                     ▼
          ┌─────────────────────┐
          │   MySQL Database    │
          │   (zero_trust_db)   │
          └─────────────────────┘
```

### Komunikasi Antar-Service

- Service Nilai meminta **token service** ke Gateway (`POST /auth/service`) menggunakan *client credentials*
- Request sinkronisasi transkrip **tetap melewati Gateway** agar policy engine mencatat dan memvalidasi akses
- Setiap service memverifikasi `X-Gateway-Secret` dan JWT secara **independen** — tidak mengandalkan keputusan Gateway semata

---

## Fitur Utama

| Fitur | Deskripsi |
|---|---|
| 🔐 **Autentikasi JWT** | Access token berumur 10 menit + refresh token 1 hari |
| 📱 **Device Binding** | Setiap login & request wajib menyertakan device ID terdaftar |
| 🔑 **RBAC** | Tiga role: `admin`, `dosen`, `mahasiswa` — masing-masing dengan hak akses berbeda |
| 📜 **Policy Engine** | Evaluasi kebijakan per-request: role, kepemilikan data, kelas yang diampu, jam akses |
| ⏰ **Pembatasan Jam Akses** | Perubahan & finalisasi nilai hanya diizinkan pada jam operasional (default 07:00–21:00) |
| 🔄 **Service-to-Service Auth** | Token service khusus dengan secret terpisah untuk komunikasi antar-microservice |
| 📝 **Audit Logging** | Setiap keputusan allow/deny dicatat lengkap (subjek, endpoint, device, alasan) |
| 🛡️ **Gateway Secret** | Service hanya menerima request yang memiliki `X-Gateway-Secret` yang valid |
| 🔒 **Timing-Safe Comparison** | Service Transkrip menggunakan `crypto.timingSafeEqual` untuk mencegah timing attack |
| 📊 **Frontend Dashboard** | SPA modern dengan request tracing, manajemen nilai, transkrip, dan audit log |

---

## Tech Stack

| Komponen | Teknologi |
|---|---|
| **Runtime** | Node.js |
| **Framework** | Express.js v5 |
| **Database** | MySQL (via `mysql2/promise`) |
| **Autentikasi** | JSON Web Token (`jsonwebtoken`) |
| **Hashing** | bcrypt (password), SHA-256 (refresh token) |
| **Frontend** | HTML5, CSS3 (vanilla), JavaScript (vanilla) |
| **Font** | IBM Plex Sans, IBM Plex Mono (Google Fonts) |
| **Konfigurasi** | dotenv |

---

## Prasyarat

- **Node.js** ≥ 18 (dibutuhkan untuk native `fetch` dan `crypto`)
- **MySQL** ≥ 8.0
- **npm** ≥ 8

---

## Instalasi & Konfigurasi

### 1. Clone Repository

```bash
git clone https://github.com/FitoAnugrah/zero-trust-security.git
cd zero-trust-security
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Konfigurasi Environment

Buat file `.env` di root proyek:

```env
# Database
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=zero_trust_db

# Port service
PORT_GATEWAY=3000
PORT_NILAI=3001
PORT_TRANSKRIP=3002

# JWT Secrets
JWT_SECRET=your-jwt-secret-key
SERVICE_JWT_SECRET=your-service-jwt-secret-key

# Gateway Secret (shared antara Gateway dan semua service)
GATEWAY_SECRET=your-gateway-shared-secret

# Service-to-Service Credentials
SERVICE_CLIENT_ID=nilai-service
SERVICE_CLIENT_SECRET=your-service-client-secret

# Jam Akses (opsional, default 7–21)
ACCESS_START_HOUR=7
ACCESS_END_HOUR=21
```

> ⚠️ **Penting:** Pastikan `JWT_SECRET`, `SERVICE_JWT_SECRET`, dan `GATEWAY_SECRET` menggunakan string yang kuat dan berbeda satu sama lain.

### 4. Setup Database

Buat database dan jalankan schema:

```sql
CREATE DATABASE IF NOT EXISTS zero_trust_db;
```

Lalu jalankan file schema:

```bash
mysql -u root -p zero_trust_db < database/schema.sql
```

### 5. Seed Data Demo

```bash
npm run seed
```

Perintah ini akan membuat:
- 6 akun pengguna (1 admin, 2 dosen, 3 mahasiswa)
- 6 perangkat terdaftar
- 2 kelas (IF101 & IF102)
- 6 enrollment mahasiswa
- 6 nilai awal (belum difinalisasi)

---

## Menjalankan Aplikasi

Jalankan ketiga service pada terminal terpisah:

```bash
# Terminal 1 — API Gateway (melayani frontend juga)
npm run start:gateway

# Terminal 2 — Service Nilai
npm run start:nilai

# Terminal 3 — Service Transkrip
npm run start:transkrip
```

Atau jalankan hanya Gateway (frontend + auth):

```bash
npm start
```

Buka browser di: **http://localhost:3000**

---

## Struktur Proyek

```
zero-trust-security/
├── frontend/
│   ├── index.html          # SPA — login screen + dashboard
│   ├── app.js              # Logika frontend (auth, routing, API calls)
│   └── styles.css          # Styling lengkap (dark sidebar, cards, tables)
│
├── gateway/
│   ├── server.js           # API Gateway — auth endpoints + proxy middleware
│   └── policy.js           # Policy Engine — evaluasi kebijakan per request
│
├── service-nilai/
│   └── server.js           # Microservice nilai — CRUD + finalisasi
│
├── service-transkrip/
│   └── server.js           # Microservice transkrip — read + sinkronisasi
│
├── database/
│   ├── db.js               # Koneksi pool MySQL
│   ├── schema.sql          # DDL semua tabel
│   ├── seed.js             # Data awal untuk demo
│   └── migrate-add-nim.sql # Migrasi tambah kolom NIM
│
├── package.json
├── .env                    # Konfigurasi (tidak di-commit)
└── .gitignore
```

---

## Alur Keamanan Zero Trust

### Alur Login

```
User ──▶ POST /auth/login (username, password, X-Device-ID)
              │
              ├─ ❌ Kredensial salah → 401 + audit log (DENY)
              ├─ ❌ Device tidak terdaftar → 403 + audit log (DENY)
              │
              └─ ✅ Berhasil:
                   ├─ Access token (JWT, 10 menit)
                   ├─ Refresh token (random, 1 hari, hash SHA-256 disimpan di DB)
                   └─ Audit log (ALLOW)
```

### Alur Request Data

```
User ──▶ Request + Bearer JWT + X-Device-ID
              │
    ┌─────────▼──────────┐
    │ Gateway Middleware  │
    ├────────────────────┤
    │ 1. Cek Bearer token│── ❌ → 401
    │ 2. Verifikasi JWT  │── ❌ → 401
    │ 3. Cek device      │── ❌ → 403
    │ 4. Policy Engine   │── ❌ → 403/404
    │    • Role check     │
    │    • Ownership check│
    │    • Jam akses      │
    │ 5. Audit log        │
    │ 6. Proxy ke service │
    └─────────┬──────────┘
              ▼
    ┌─────────────────────┐
    │ Target Service      │
    │ (Nilai / Transkrip) │
    ├─────────────────────┤
    │ • Verifikasi        │
    │   X-Gateway-Secret  │
    │ • Verifikasi JWT    │
    │   (independen)      │
    │ • Validasi bisnis   │
    └─────────────────────┘
```

### Alur Finalisasi & Sinkronisasi

```
Dosen ──▶ POST /kelas/:id/finalisasi
              │
    ┌─────────▼──────────────┐
    │ Gateway (policy check) │
    └─────────┬──────────────┘
              ▼
    ┌──────────────────────────┐
    │ Service Nilai            │
    │ 1. Verifikasi kelas milik│
    │    dosen                 │
    │ 2. SET is_final = TRUE   │
    │ 3. Minta service token   │──▶ POST /auth/service
    │    dari Gateway          │◀── (Service JWT, 5 menit)
    │ 4. Kirim sinkronisasi    │──▶ POST /transkrip/sinkron
    │    via Gateway           │    (melalui Gateway lagi!)
    └──────────────────────────┘
                                         │
                               ┌─────────▼─────────┐
                               │ Service Transkrip  │
                               │ INSERT/UPDATE      │
                               │ transcripts table  │
                               └────────────────────┘
```

---

## API Endpoints

### Autentikasi (Gateway)

| Method | Endpoint | Akses | Deskripsi |
|--------|----------|-------|-----------|
| `POST` | `/auth/login` | Publik | Login dengan username, password, & device ID |
| `POST` | `/auth/refresh` | Terautentikasi | Perbarui access token menggunakan refresh token |
| `POST` | `/auth/logout` | Terautentikasi | Cabut refresh token |
| `POST` | `/auth/service` | Service | Minta service token (client credentials) |
| `GET`  | `/health` | Publik | Health check gateway |

### Service Nilai (via Gateway)

| Method | Endpoint | Akses | Deskripsi |
|--------|----------|-------|-----------|
| `GET` | `/nilai` | `dosen`, `mahasiswa` | Lihat nilai (dibatasi per role & kelas) |
| `PUT` | `/nilai/:id` | `dosen` | Ubah nilai (sebelum final, jam akses, kelas sendiri) |
| `POST` | `/kelas/:id/finalisasi` | `dosen` | Finalisasi nilai kelas + sinkron transkrip |

### Service Transkrip (via Gateway)

| Method | Endpoint | Akses | Deskripsi |
|--------|----------|-------|-----------|
| `GET` | `/transkrip/:nim` | `admin`, `mahasiswa` (NIM sendiri) | Lihat transkrip akademik |
| `POST` | `/transkrip/sinkron` | `service` (nilai-service) | Sinkronisasi nilai final ke transkrip |

### Admin (via Gateway)

| Method | Endpoint | Akses | Deskripsi |
|--------|----------|-------|-----------|
| `GET` | `/admin/audit?limit=N` | `admin` | Lihat audit log keputusan akses (max 100) |

---

## Skema Database

```
zero_trust_db
├── users            # Pengguna (admin, dosen, mahasiswa) + NIM
├── devices          # Perangkat terdaftar per user
├── classes          # Kelas + dosen pengampu
├── enrollments      # Mahasiswa terdaftar per kelas
├── grades           # Nilai (draft/final) per mahasiswa per kelas
├── transcripts      # Transkrip tersinkron (nilai final)
├── refresh_tokens   # Refresh token (hash SHA-256, revocable)
└── audit_logs       # Log keputusan akses (allow/deny)
```

---

## Akun Demo

Setelah menjalankan `npm run seed`, akun berikut tersedia:

| Role | Username | Password | Device ID | NIM |
|------|----------|----------|-----------|-----|
| Admin | `admin` | `Admin123!` | `DEV-ADMIN-001` | — |
| Dosen | `dosen1` | `Dosen123!` | `DEV-DOSEN-001` | — |
| Dosen | `dosen2` | `Dosen456!` | `DEV-DOSEN-002` | — |
| Mahasiswa | `mhs1` | `Mhs123!` | `DEV-MHS-001` | `2024001` |
| Mahasiswa | `mhs2` | `Mhs456!` | `DEV-MHS-002` | `2024002` |
| Mahasiswa | `mhs3` | `Mhs789!` | `DEV-MHS-003` | `2024003` |

### Kelas Demo

| Kode | Mata Kuliah | Dosen |
|------|-------------|-------|
| IF101 | Algoritma dan Pemrograman | dosen1 |
| IF102 | Basis Data | dosen2 |

### Skenario Pengujian

1. **Login sebagai `dosen1`** → Lihat & ubah nilai kelas IF101 → Finalisasi → Transkrip otomatis tersinkron
2. **Login sebagai `mhs1`** → Lihat nilai sendiri → Lihat transkrip NIM sendiri → Coba akses NIM lain (ditolak)
3. **Login sebagai `admin`** → Lihat audit log → Lihat transkrip mahasiswa mana pun
4. **Gunakan device ID yang salah** → Login ditolak dengan alasan "Device tidak terdaftar"
5. **Akses di luar jam operasional** → Ubah `ACCESS_END_HOUR=0` di `.env` → Perubahan nilai ditolak

---

## Lisensi

Proyek ini dilisensikan di bawah [ISC License](https://opensource.org/licenses/ISC).
