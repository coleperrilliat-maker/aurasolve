import pg from "pg";

function mapRow(row) {
  if (!row) return null;
  return {
    email: row.email,
    passwordHash: row.password_hash || null,
    googleSub: row.google_sub || null,
    resetNonce: row.reset_nonce || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    lastLoginMethod: row.last_login_method || null,
  };
}

function duplicate(error) {
  if (error?.code !== "23505") return false;
  const err = new Error("That account already exists.");
  err.status = 409;
  return err;
}

export async function createPostgresUsers(connectionString) {
  const internal = /railway\.internal|localhost|127\.0\.0\.1/.test(connectionString);
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    ssl: internal ? false : {rejectUnauthorized: false},
  });
  await pool.query(`create table if not exists users (
    email text primary key,
    password_hash text,
    google_sub text unique,
    reset_nonce text,
    created_at timestamptz not null default now()
  )`);
  await pool.query(`alter table users add column if not exists last_login_at timestamptz`);
  await pool.query(`alter table users add column if not exists last_login_method text`);
  return {
    async getByEmail(email) {
      return mapRow((await pool.query(
        "select email, password_hash, google_sub, reset_nonce, created_at, last_login_at, last_login_method from users where email = $1",
        [email],
      )).rows[0]);
    },
    async getByGoogle(sub) {
      return mapRow((await pool.query(
        "select email, password_hash, google_sub, reset_nonce, created_at, last_login_at, last_login_method from users where google_sub = $1",
        [sub],
      )).rows[0]);
    },
    async create(user) {
      try {
        await pool.query(
          "insert into users (email, password_hash, google_sub) values ($1, $2, $3)",
          [user.email, user.passwordHash || null, user.googleSub || null],
        );
      } catch (error) {
        const exists = duplicate(error);
        if (exists) throw exists;
        throw error;
      }
    },
    async setPassword(email, passwordHash) {
      await pool.query("update users set password_hash = $2, reset_nonce = null where email = $1", [email, passwordHash]);
    },
    async linkGoogle(email, sub) {
      try {
        await pool.query("update users set google_sub = $2 where email = $1", [email, sub]);
      } catch (error) {
        const exists = duplicate(error);
        if (exists) throw exists;
        throw error;
      }
    },
    async setResetNonce(email, nonce) {
      const result = await pool.query("update users set reset_nonce = $2 where email = $1", [email, nonce]);
      return result.rowCount > 0;
    },
    async recordLogin(email, method) {
      await pool.query(
        "update users set last_login_at = now(), last_login_method = $2 where email = $1",
        [email, method || "unknown"],
      );
    },
    async listAccounts({limit = 100} = {}) {
      const rows = (await pool.query(
        `select email, password_hash, google_sub, created_at, last_login_at, last_login_method
         from users
         order by coalesce(last_login_at, created_at) desc nulls last
         limit $1`,
        [Math.min(Math.max(Number(limit) || 100, 1), 500)],
      )).rows;
      return rows.map(row => ({
        email: row.email,
        hasPassword: Boolean(row.password_hash),
        hasGoogle: Boolean(row.google_sub),
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
        lastLoginMethod: row.last_login_method || null,
      }));
    },
    async accountStats() {
      const row = (await pool.query(
        `select
           count(*)::int as total,
           count(*) filter (where google_sub is not null)::int as google,
           count(*) filter (where password_hash is not null)::int as password,
           count(*) filter (where last_login_at >= now() - interval '1 day')::int as signed_in_today,
           count(*) filter (where last_login_at >= now() - interval '7 day')::int as signed_in_7d
         from users`,
      )).rows[0] || {};
      return {
        total: Number(row.total) || 0,
        google: Number(row.google) || 0,
        password: Number(row.password) || 0,
        signedInToday: Number(row.signed_in_today) || 0,
        signedIn7d: Number(row.signed_in_7d) || 0,
      };
    },
  };
}

export function createMemoryUsers() {
  const byEmail = new Map();
  const byGoogle = new Map();
  const copy = user => user ? {...user} : null;
  return {
    async getByEmail(email) { return copy(byEmail.get(email)); },
    async getByGoogle(sub) { return copy(byGoogle.get(sub)); },
    async create(user) {
      if (byEmail.has(user.email) || (user.googleSub && byGoogle.has(user.googleSub))) {
        throw Object.assign(new Error("That account already exists."), {status: 409});
      }
      const stored = {
        email: user.email,
        passwordHash: user.passwordHash || null,
        googleSub: user.googleSub || null,
        resetNonce: null,
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
        lastLoginMethod: null,
      };
      byEmail.set(user.email, stored);
      if (stored.googleSub) byGoogle.set(stored.googleSub, stored);
    },
    async setPassword(email, passwordHash) {
      const user = byEmail.get(email);
      if (!user) return;
      user.passwordHash = passwordHash;
      user.resetNonce = null;
    },
    async linkGoogle(email, sub) {
      const user = byEmail.get(email);
      if (!user) return;
      if (byGoogle.has(sub) && byGoogle.get(sub) !== user) throw Object.assign(new Error("That account already exists."), {status: 409});
      if (user.googleSub) byGoogle.delete(user.googleSub);
      user.googleSub = sub;
      byGoogle.set(sub, user);
    },
    async setResetNonce(email, nonce) {
      const user = byEmail.get(email);
      if (!user) return false;
      user.resetNonce = nonce;
      return true;
    },
    async recordLogin(email, method) {
      const user = byEmail.get(email);
      if (!user) return;
      user.lastLoginAt = new Date().toISOString();
      user.lastLoginMethod = method || "unknown";
    },
    async listAccounts({limit = 100} = {}) {
      return [...byEmail.values()]
        .sort((a, b) => String(b.lastLoginAt || b.createdAt || "").localeCompare(String(a.lastLoginAt || a.createdAt || "")))
        .slice(0, Math.min(Math.max(Number(limit) || 100, 1), 500))
        .map(user => ({
          email: user.email,
          hasPassword: Boolean(user.passwordHash),
          hasGoogle: Boolean(user.googleSub),
          createdAt: user.createdAt || null,
          lastLoginAt: user.lastLoginAt || null,
          lastLoginMethod: user.lastLoginMethod || null,
        }));
    },
    async accountStats() {
      const all = [...byEmail.values()];
      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;
      return {
        total: all.length,
        google: all.filter(u => u.googleSub).length,
        password: all.filter(u => u.passwordHash).length,
        signedInToday: all.filter(u => u.lastLoginAt && now - Date.parse(u.lastLoginAt) <= day).length,
        signedIn7d: all.filter(u => u.lastLoginAt && now - Date.parse(u.lastLoginAt) <= 7 * day).length,
      };
    },
  };
}
