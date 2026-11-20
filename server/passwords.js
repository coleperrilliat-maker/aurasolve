import crypto from "node:crypto";
import {promisify} from "node:util";

const scrypt = promisify(crypto.scrypt);
const KEY_LEN = 32;

export function passwordProblems(value) {
  const text = typeof value === "string" ? value : "";
  const problems = [];
  if (text.length < 8 || text.length > 200) problems.push("8 to 200 characters");
  if (!/[a-z]/.test(text)) problems.push("a lowercase letter");
  if (!/[A-Z]/.test(text)) problems.push("an uppercase letter");
  if (!/[0-9]/.test(text)) problems.push("a number");
  return problems;
}
export function passwordOk(value) {
  return passwordProblems(value).length === 0;
}
export function passwordError(value) {
  const problems = passwordProblems(value);
  return problems.length ? `Password needs ${problems.join(", ")}.` : "";
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
