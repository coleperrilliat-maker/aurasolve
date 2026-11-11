import crypto from "node:crypto";
import {promisify} from "node:util";

const scrypt = promisify(crypto.scrypt);
const KEY_LEN = 32;

export function passwordOk(value) {
  return typeof value === "string" && value.length >= 8 && value.length <= 200;
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password, stored) {
  const [kind, salt, hash] = String(stored || "").split("$");
  if (kind !== "scrypt" || !salt || !hash || typeof password !== "string") return false;
  let expected;
  let saltBytes;
  try {
    saltBytes = Buffer.from(salt, "base64url");
    expected = Buffer.from(hash, "base64url");
  } catch { return false; }
  if (!saltBytes.length || expected.length !== KEY_LEN) return false;
  const actual = await scrypt(password, saltBytes, KEY_LEN);
  return crypto.timingSafeEqual(actual, expected);
}

export function sameText(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Used when the email has no password, so a missing account takes the same time as a wrong one.
export const dummyPasswordHash = hashPassword("aurasolve-dummy-password");
