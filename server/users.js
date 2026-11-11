import pg from "pg";

function mapRow(row) {
  if (!row) return null;
  return {
    email: row.email,
    passwordHash: row.password_hash || null,
    googleSub: row.google_sub || null,
    resetNonce: row.reset_nonce || null,
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
  return {
    async getByEmail(email) {
      return mapRow((await pool.query("select email, password_hash, google_sub, reset_nonce from users where email = $1", [email])).rows[0]);
    },
    async getByGoogle(sub) {
      return mapRow((await pool.query("select email, password_hash, google_sub, reset_nonce from users where google_sub = $1", [sub])).rows[0]);
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
      const stored = {email: user.email, passwordHash: user.passwordHash || null, googleSub: user.googleSub || null, resetNonce: null};
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
  };
}
