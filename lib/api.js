import http from "k6/http";
import { check, fail } from "k6";

export const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
export const PARTNER_KEY = __ENV.PARTNER_KEY || "ROADTOSDET";
const DEFAULT_OTP = __ENV.DEFAULT_OTP || "0000";

const JSON_HEADERS = { "Content-Type": "application/json" };

// API name -> endpoint path and the success message the backend returns.
// The SYSTEM -> Agent deposit uses a different message than Agent -> Customer.
export const TRANSACTION_APIS = {
  deposit: { path: "/transaction/deposit", message: "Deposit successful" },
  sendmoney: { path: "/transaction/sendmoney", message: "Send money successful" },
  payment: { path: "/transaction/payment", message: "Payment successful" },
};

function authHeaders(token) {
  return {
    ...JSON_HEADERS,
    Authorization: `Bearer ${token}`,
    "X-AUTH-SECRET-KEY": PARTNER_KEY,
  };
}

function safeJson(res, field) {
  try {
    return res.json(field);
  } catch (e) {
    return undefined;
  }
}

// Logs a user in (by email or phone number) and returns a JWT. Admin and SYSTEM get a token straight from
// /user/login; Agents, Customers and Merchants must verify an OTP first, which
// uses the backend's dev bypass (?env=dev with DEFAULT_OTP).
export function login(identifier, password) {
  const tags = { api: "auth", name: "POST /user/login" };
  const loginRes = http.post(
    `${BASE_URL}/user/login`,
    JSON.stringify(identifier.includes("@") ? { email: identifier, password } : { phone_number: identifier, password }),
    { headers: JSON_HEADERS, tags },
  );
  check(loginRes, { "login: status is 200": (r) => r.status === 200 }, tags);

  const directToken = safeJson(loginRes, "token");
  if (directToken) return directToken;

  const otpTags = { api: "auth", name: "POST /user/verify-otp" };
  const otpRes = http.post(
    `${BASE_URL}/user/verify-otp?env=dev`,
    JSON.stringify({ identifier, otp: DEFAULT_OTP }),
    { headers: JSON_HEADERS, tags: otpTags },
  );
  check(otpRes, { "verify otp: status is 200": (r) => r.status === 200 }, otpTags);

  const token = safeJson(otpRes, "token");
  if (!token) fail(`Login failed for ${identifier}: ${loginRes.status} ${loginRes.body} / ${otpRes.status} ${otpRes.body}`);
  return token;
}

export function getBalance(token, account) {
  const res = http.get(`${BASE_URL}/transaction/balance/${account}`, {
    headers: authHeaders(token),
    tags: { api: "balance", name: "GET /transaction/balance" },
  });
  if (res.status !== 200) fail(`Balance lookup for ${account} failed: ${res.status} ${res.body}`);
  return Number(res.json("balance"));
}

// Sends one transaction request. Setup traffic is tagged phase=setup so it can
// be told apart from the measured workload.
export function transact(api, token, from, to, amount, extraTags = {}) {
  const tags = { api, name: `POST ${TRANSACTION_APIS[api].path}`, ...extraTags };
  return http.post(
    `${BASE_URL}${TRANSACTION_APIS[api].path}`,
    JSON.stringify({ from_account: from, to_account: to, amount }),
    { headers: authHeaders(token), tags },
  );
}

// The assertions every transaction response must pass. Every check is tagged
// kind=transaction plus the api/phase so per-API and global thresholds can use them.
export function checkTransaction(res, api, expectedMessage, tags = {}) {
  const checkTags = { kind: "transaction", api, ...tags };
  const label = api.toUpperCase();
  return check(
    res,
    {
      [`${label}: status is 201`]: (r) => r.status === 201,
      [`${label}: transaction is successful`]: (r) => {
        const message = safeJson(r, "message");
        return r.status === 201 && typeof message === "string" && message.toLowerCase().includes("successful");
      },
      [`${label}: trnxId is returned`]: (r) => {
        const trnxId = safeJson(r, "trnxId");
        return typeof trnxId === "string" && trnxId.length > 0;
      },
      [`${label}: success message is "${expectedMessage}"`]: (r) => safeJson(r, "message") === expectedMessage,
    },
    checkTags,
  );
}
