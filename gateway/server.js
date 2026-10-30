const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const db = require('../database/db');
const { evaluatePolicy } = require('./policy');

require('dotenv').config({
  path: path.resolve(__dirname, '../.env'),
  override: true,
});

const app = express();
app.use(express.json());
app.use(express.static(path.resolve(__dirname, '../frontend')));

const PORT = Number(process.env.PORT_GATEWAY || 3000);

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createAccessToken(user) {
  return jwt.sign(
    { role: user.role },
    process.env.JWT_SECRET,
    {
      subject: String(user.id),
      expiresIn: '10m',
    }
  );
}

async function audit(subject, endpoint, deviceId, decision, reason) {
  try {
    await db.execute(
      `INSERT INTO audit_logs
       (subject, endpoint, device_id, decision, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [
        String(subject || 'unknown'),
        endpoint,
        deviceId || null,
        decision,
        reason,
      ]
    );
  } catch (error) {
    console.error('Audit log gagal:', error.message);
  }
}

async function isRegisteredDevice(userId, deviceId) {
  if (!deviceId) return false;

  const [rows] = await db.execute(
    `SELECT id FROM devices
     WHERE user_id = ? AND device_id = ? AND is_active = TRUE`,
    [userId, deviceId]
  );

  return rows.length > 0;
}

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Zero Trust API Gateway',
  });
});

// LOGIN
app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const deviceId = req.get('X-Device-ID');

  try {
    const [rows] = await db.execute(
      `SELECT id, username, full_name, role, nim, password_hash
       FROM users WHERE username = ?`,
      [username || '']
    );

    const user = rows[0];

    if (!user || !password ||
        !(await bcrypt.compare(password, user.password_hash))) {
      await audit(username || 'unknown', req.originalUrl,
        deviceId, 'deny', 'Kredensial tidak valid');

      return res.status(401).json({
        error: 'Username atau password salah',
      });
    }

    if (!(await isRegisteredDevice(user.id, deviceId))) {
      await audit(user.username, req.originalUrl,
        deviceId, 'deny', 'Device tidak terdaftar');

      return res.status(403).json({
        error: 'Device tidak terdaftar untuk pengguna ini',
      });
    }

    const accessToken = createAccessToken(user);
    const refreshToken = crypto.randomBytes(32).toString('hex');

    await db.execute(
      `INSERT INTO refresh_tokens
       (user_id, token_hash, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))`,
      [user.id, hashToken(refreshToken)]
    );

    await audit(user.username, req.originalUrl,
      deviceId, 'allow', 'Login berhasil');

    return res.json({
      message: 'Login berhasil',
      accessToken,
      refreshToken,
      expiresIn: '10m',
      user: {
        id: user.id,
        username: user.username,
        name: user.full_name,
        role: user.role,
        nim: user.nim,
      },
    });
  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({
      error: 'Terjadi kesalahan pada server',
    });
  }
});

// REFRESH TOKEN
app.post('/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  const deviceId = req.get('X-Device-ID');

  try {
    if (!refreshToken || !deviceId) {
      return res.status(400).json({
        error: 'Refresh token dan X-Device-ID wajib diisi',
      });
    }

    const [rows] = await db.execute(
      `SELECT rt.id AS refresh_id, u.id, u.username, u.role
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = ?
         AND rt.revoked_at IS NULL
         AND rt.expires_at > NOW()`,
      [hashToken(refreshToken)]
    );

    const user = rows[0];

    if (!user ||
        !(await isRegisteredDevice(user.id, deviceId))) {
      await audit(user?.username || 'unknown',
        req.originalUrl, deviceId, 'deny',
        'Refresh token tidak valid atau device ditolak');

      return res.status(401).json({
        error: 'Refresh token tidak valid atau device ditolak',
      });
    }

    const accessToken = createAccessToken(user);

    await audit(user.username, req.originalUrl,
      deviceId, 'allow', 'Token berhasil diperbarui');

    return res.json({
      accessToken,
      expiresIn: '10m',
    });
  } catch (error) {
    console.error('Refresh error:', error.message);
    return res.status(500).json({
      error: 'Terjadi kesalahan pada server',
    });
  }
});

// LOGOUT: mencabut refresh token
app.post('/auth/logout', async (req, res) => {
  const { refreshToken } = req.body || {};
  const deviceId = req.get('X-Device-ID');

  try {
    if (!refreshToken || !deviceId) {
      return res.status(400).json({
        error: 'Refresh token dan X-Device-ID wajib diisi',
      });
    }

    const [rows] = await db.execute(
      `SELECT rt.id AS refresh_id, u.id, u.username
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = ?
         AND rt.revoked_at IS NULL
         AND rt.expires_at > NOW()`,
      [hashToken(refreshToken)]
    );

    const user = rows[0];

    if (!user ||
        !(await isRegisteredDevice(user.id, deviceId))) {
      await audit(user?.username || 'unknown',
        req.originalUrl, deviceId, 'deny',
        'Token logout tidak valid');

      return res.status(401).json({
        error: 'Token tidak valid atau device ditolak',
      });
    }

    await db.execute(
      `UPDATE refresh_tokens
       SET revoked_at = NOW()
       WHERE id = ? AND revoked_at IS NULL`,
      [user.refresh_id]
    );

    await audit(user.username, req.originalUrl,
      deviceId, 'allow', 'Logout berhasil; refresh token dicabut');

    return res.json({
      message: 'Logout berhasil',
    });
  } catch (error) {
    console.error('Logout error:', error.message);
    return res.status(500).json({
      error: 'Terjadi kesalahan pada server',
    });
  }
});

// TOKEN KHUSUS UNTUK SERVICE NILAI
app.post('/auth/service', async (req, res) => {
  const { clientId, clientSecret } = req.body || {};

  if (
    !clientId ||
    !clientSecret ||
    clientId !== process.env.SERVICE_CLIENT_ID ||
    clientSecret !== process.env.SERVICE_CLIENT_SECRET
  ) {
    await audit('nilai-service', req.originalUrl,
      null, 'deny', 'Client credentials tidak valid');

    return res.status(401).json({
      error: 'Client credentials tidak valid',
    });
  }

  const token = jwt.sign(
    { role: 'service' },
    process.env.SERVICE_JWT_SECRET,
    {
      subject: 'nilai-service',
      expiresIn: '5m',
    }
  );

  await audit('nilai-service', req.originalUrl,
    null, 'allow', 'Token service diterbitkan');

  return res.json({
    accessToken: token,
    expiresIn: '5m',
  });
});

// MIDDLEWARE ZERO TRUST
// Letakkan setelah seluruh route /auth/* dan sebelum app.listen().

app.use(async (req, res) => {
  // Endpoint autentikasi yang tidak dikenal tidak boleh diteruskan.
  if (req.path.startsWith('/auth/')) {
    return res.status(404).json({
      error: 'Endpoint autentikasi tidak ditemukan',
    });
  }

  const authorization = req.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const deviceId = req.get('X-Device-ID');
  const isServiceEndpoint =
    req.method === 'POST' &&
    req.path === '/transkrip/sinkron';

  if (!match) {
    await audit('unknown', req.originalUrl, deviceId,
      'deny', 'Bearer token tidak ditemukan');

    return res.status(401).json({
      error: 'Bearer token wajib disertakan',
    });
  }

  // Token service dan token pengguna menggunakan secret berbeda.
  let claims;

  try {
    claims = jwt.verify(
      match[1],
      isServiceEndpoint
        ? process.env.SERVICE_JWT_SECRET
        : process.env.JWT_SECRET
    );
  } catch (error) {
    await audit('unknown', req.originalUrl, deviceId,
      'deny', 'Token tidak valid atau kedaluwarsa');

    return res.status(401).json({
      error: 'Token tidak valid atau sudah kedaluwarsa',
    });
  }

  // Request pengguna harus berasal dari perangkat terdaftar.
  // Panggilan service menggunakan token service tersendiri.
  if (!isServiceEndpoint) {
    const userId = Number(claims.sub);

    if (!Number.isInteger(userId) || userId <= 0) {
      await audit(claims.sub || 'unknown',
        req.originalUrl, deviceId, 'deny',
        'Identitas pengguna tidak valid');

      return res.status(401).json({
        error: 'Identitas pengguna tidak valid',
      });
    }

    if (!(await isRegisteredDevice(userId, deviceId))) {
      await audit(claims.sub, req.originalUrl, deviceId,
        'deny', 'Device tidak terdaftar');

      return res.status(403).json({
        error: 'Device tidak terdaftar',
      });
    }
  }

  try {
    // Policy Engine memeriksa role, kepemilikan data,
    // kelas yang diampu, serta jam akses.
    const decision = await evaluatePolicy({
      method: req.method,
      pathname: req.path,
      claims,
      db,
    });

    if (!decision.allow) {
      await audit(claims.sub, req.originalUrl, deviceId,
        'deny', decision.reason);

      return res.status(decision.statusCode || 403).json({
        error: 'Akses ditolak',
        reason: decision.reason,
      });
    }

    // Catat keputusan akses sebelum meneruskan request.
    await audit(claims.sub, req.originalUrl, deviceId,
      'allow', decision.reason);

    const targetPort =
      decision.service === 'nilai'
        ? Number(process.env.PORT_NILAI || 3001)
        : decision.service === 'transkrip'
          ? Number(process.env.PORT_TRANSKRIP || 3002)
          : null;

    if (decision.service === 'gateway' && req.method === 'GET' && req.path === '/admin/audit') {
      const requestedLimit = Number(req.query.limit || 30);
      const limit = Number.isInteger(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 1), 100)
        : 30;

      const [rows] = await db.execute(
        `SELECT id, event_time, subject, endpoint, device_id,
                decision, reason
         FROM audit_logs
         ORDER BY id DESC
         LIMIT ?`,
        [limit]
      );

      return res.json({ data: rows });
    }

    if (!targetPort) {
      return res.status(500).json({
        error: 'Tujuan service tidak valid',
      });
    }

    const headers = {
      Authorization: authorization,
      'X-Gateway-Secret': process.env.GATEWAY_SECRET || '',
    };

    if (deviceId) {
      headers['X-Device-ID'] = deviceId;
    }

    if (req.get('Content-Type')) {
      headers['Content-Type'] = req.get('Content-Type');
    }

    if (req.get('Accept')) {
      headers.Accept = req.get('Accept');
    }

    const hasBody = !['GET', 'HEAD'].includes(req.method);

    const upstream = await fetch(
      `http://127.0.0.1:${targetPort}${req.originalUrl}`,
      {
        method: req.method,
        headers,
        body: hasBody
          ? JSON.stringify(req.body ?? {})
          : undefined,
      }
    );

    const contentType = upstream.headers.get('content-type');

    if (contentType) {
      res.set('Content-Type', contentType);
    }

    const responseBody = Buffer.from(
      await upstream.arrayBuffer()
    );

    return res.status(upstream.status).send(responseBody);
  } catch (error) {
    console.error('Gateway middleware error:', error.message);

    return res.status(500).json({
      error: 'Terjadi kesalahan saat memproses kebijakan akses',
    });
  }
});

app.listen(PORT, () => {
  console.log(`API Gateway berjalan di http://localhost:${PORT}`);
});
