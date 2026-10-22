// Creates the 6 DMoney test users (Agent 1/2, Customer 1/2, Merchant 1/2)
// through the admin API and saves them to data/users.json.
//
// Usage: node scripts/create-users.mjs
// Env:   BASE_URL (default http://localhost:5000)
//        ADMIN_EMAIL / ADMIN_PASSWORD (default admin@dmoney.com / 1234)
//        PARTNER_KEY (default ROADTOSDET)
//        FORCE=1 to create a fresh set even if data/users.json exists

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@dmoney.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234";
const PARTNER_KEY = process.env.PARTNER_KEY || "ROADTOSDET";
const EMAIL_USER = "mashrur.safir.shabab";
const USER_PASSWORD = "1234";

const OUT_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../data/users.json");

const USERS = [
  { key: "agent1", role: "Agent" },
  { key: "agent2", role: "Agent" },
  { key: "customer1", role: "Customer" },
  { key: "customer2", role: "Customer" },
  { key: "merchant1", role: "Merchant" },
  { key: "merchant2", role: "Merchant" },
];

const FIRST_NAMES = ["Arif", "Nadia", "Tanvir", "Farhana", "Rakib", "Sumaiya", "Imran", "Lamia", "Sabbir", "Tasnim"];
const LAST_NAMES = ["Hossain", "Rahman", "Islam", "Ahmed", "Chowdhury", "Karim", "Sarkar", "Uddin"];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");

if (existsSync(OUT_FILE) && !process.env.FORCE) {
  console.log(`${OUT_FILE} already exists. Set FORCE=1 to create a new set of users.`);
  process.exit(0);
}

const loginRes = await fetch(`${BASE_URL}/user/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
});
const { token } = await loginRes.json();
if (!token) throw new Error(`Admin login failed with status ${loginRes.status}`);

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
  "X-AUTH-SECRET-KEY": PARTNER_KEY,
};

const runId = Date.now().toString(36);
const created = {};

for (const { key, role } of USERS) {
  const user = {
    name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    email: `${EMAIL_USER}+k6${key}${runId}@gmail.com`,
    password: USER_PASSWORD,
    phone_number: `01${pick(["3", "5", "6", "7", "8", "9"])}${digits(8)}`,
    nid: digits(10),
    role,
  };

  const res = await fetch(`${BASE_URL}/user/create`, {
    method: "POST",
    headers,
    body: JSON.stringify(user),
  });
  const body = await res.json();
  if (res.status !== 201) throw new Error(`Creating ${key} failed (${res.status}): ${body.message}`);

  // New users start as "pending"; transactions require "active" accounts
  const activateRes = await fetch(`${BASE_URL}/user/update/${body.user.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "active" }),
  });
  if (activateRes.status !== 200) throw new Error(`Activating ${key} failed (${activateRes.status})`);

  created[key] = { ...user, id: body.user.id };
  console.log(`Created ${key.padEnd(9)} ${role.padEnd(8)} ${user.phone_number}  ${user.email}`);
}

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(created, null, 2) + "\n");
console.log(`Saved users to ${OUT_FILE}`);
