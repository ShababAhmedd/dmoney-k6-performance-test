import exec from "k6/execution";
import { fail } from "k6";
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/2.4.0/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";
import { TRANSACTION_APIS, checkTransaction, getBalance, login, transact } from "./lib/api.js";

const users = JSON.parse(open("./data/users.json"));

const SYSTEM_LOGIN = __ENV.SYSTEM_LOGIN || "system@dmoney.com";
const SYSTEM_PASSWORD = __ENV.SYSTEM_PASSWORD || "1234";

// Transactions started per second by every flow (constant arrival rate).
const RATE = Number(__ENV.RATE || 5);
const PHASE_SECONDS = Number(__ENV.PHASE_SECONDS || 30);

// Transaction amounts (tk). Send money and payment each add a 5 tk fee.
const SEND_AMOUNT = 10;
const PAYMENT_AMOUNT = 10;
const DEPOSIT_AMOUNT = 20;

// Opening balances that setup() tops the accounts up to before the load starts.
// Sized for RATE=5 so no account runs dry, and no customer goes over the
// 10,000 tk deposit cap during the run.
const AGENT_OPENING_BALANCE = 30000;
const CUSTOMER_OPENING_BALANCE = { customer1: 7000, customer2: 5000 };

const PHASES = [
  {
    id: "p1",
    label: "0-30s",
    flows: [
      { api: "sendmoney", from: "customer1", to: "customer2", amount: SEND_AMOUNT },
      { api: "payment", from: "customer2", to: "merchant1", amount: PAYMENT_AMOUNT },
    ],
  },
  {
    id: "p2",
    label: "30-60s",
    flows: [
      { api: "sendmoney", from: "customer2", to: "customer1", amount: SEND_AMOUNT },
      { api: "deposit", from: "agent1", to: "customer2", amount: DEPOSIT_AMOUNT },
      { api: "payment", from: "customer1", to: "merchant1", amount: PAYMENT_AMOUNT },
    ],
  },
  {
    id: "p3",
    label: "60-90s",
    flows: [
      { api: "deposit", from: "agent1", to: "customer1", amount: DEPOSIT_AMOUNT },
      { api: "deposit", from: "agent2", to: "customer2", amount: DEPOSIT_AMOUNT },
      { api: "sendmoney", from: "customer1", to: "customer2", amount: SEND_AMOUNT },
      { api: "payment", from: "customer2", to: "merchant2", amount: PAYMENT_AMOUNT },
    ],
  },
  {
    id: "p4",
    label: "90-120s",
    flows: [
      { api: "payment", from: "agent1", to: "merchant1", amount: PAYMENT_AMOUNT },
      { api: "payment", from: "agent2", to: "merchant2", amount: PAYMENT_AMOUNT },
      { api: "payment", from: "customer1", to: "merchant1", amount: PAYMENT_AMOUNT },
      { api: "payment", from: "customer2", to: "merchant2", amount: PAYMENT_AMOUNT },
    ],
  },
];

// One scenario per flow, e.g. "p1_customer1_sendmoney_customer2". All flows of
// a phase start together and run for the whole 30 s window.
const FLOWS = {};
const scenarios = {};
PHASES.forEach((phase, index) => {
  for (const flow of phase.flows) {
    const name = `${phase.id}_${flow.from}_${flow.api}_${flow.to}`;
    FLOWS[name] = { ...flow, phase: phase.id };
    scenarios[name] = {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: `${PHASE_SECONDS}s`,
      startTime: `${index * PHASE_SECONDS}s`,
      preAllocatedVUs: RATE * 2,
      maxVUs: RATE * 10,
      gracefulStop: "5s",
      exec: "runFlow",
      tags: { phase: phase.id, flow: name },
    };
  }
});

const thresholds = {
  // Global
  http_req_failed: ["rate<0.01"],
  http_req_duration: ["p(95)<1000"],
  checks: ["rate>=0.99"],
  "checks{kind:transaction}": ["rate>=0.99"],
};

// Separate thresholds for every transaction API
for (const api of Object.keys(TRANSACTION_APIS)) {
  thresholds[`http_req_duration{api:${api}}`] = ["p(95)<1000", "p(99)<1500"];
  thresholds[`http_reqs{api:${api}}`] = ["count>0"];
  thresholds[`http_req_failed{api:${api}}`] = ["rate<0.01"];
  thresholds[`checks{kind:transaction,api:${api}}`] = ["rate>=0.99"];
}

// Per phase x API sub-metrics, used to spot degradation as the workload changes
for (const phase of PHASES) {
  for (const api of new Set(phase.flows.map((f) => f.api))) {
    thresholds[`http_req_duration{phase:${phase.id},api:${api}}`] = ["p(95)<1000"];
    thresholds[`http_reqs{phase:${phase.id},api:${api}}`] = ["count>0"];
    thresholds[`http_req_failed{phase:${phase.id},api:${api}}`] = ["rate<0.01"];
  }
}

export const options = {
  scenarios,
  thresholds,
  setupTimeout: "120s",
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};

// Every user logs in with their own credentials, then the agents and customers
// are topped up to known opening balances so every run starts from the same state.
export function setup() {
  const tokens = {};
  for (const [key, user] of Object.entries(users)) {
    tokens[key] = login(user.phone_number, user.password);
  }
  const systemToken = login(SYSTEM_LOGIN, SYSTEM_PASSWORD);
  const setupTags = { api: "setup", phase: "setup" };
  const phone = (key) => users[key].phone_number;

  for (const agent of ["agent1", "agent2"]) {
    const balance = getBalance(systemToken, phone(agent));
    if (balance < AGENT_OPENING_BALANCE) {
      const res = transact("deposit", systemToken, "SYSTEM", phone(agent), Math.ceil(AGENT_OPENING_BALANCE - balance), setupTags);
      if (!checkTransaction(res, "deposit", "SYSTEM deposit to Agent successful", setupTags)) {
        fail(`Funding ${agent} failed: ${res.status} ${res.body}`);
      }
    }
  }

  for (const [customer, target] of Object.entries(CUSTOMER_OPENING_BALANCE)) {
    const balance = getBalance(tokens[customer], phone(customer));
    let res;
    if (balance < target - 10) {
      // Agent -> Customer deposit (minimum 10 tk)
      res = transact("deposit", tokens.agent1, phone("agent1"), phone(customer), Math.ceil(target - balance), setupTags);
      if (!checkTransaction(res, "deposit", TRANSACTION_APIS.deposit.message, setupTags)) {
        fail(`Funding ${customer} failed: ${res.status} ${res.body}`);
      }
    } else if (balance > target + 20) {
      // Spend the surplus at a merchant; the fee is max(1%, 5 tk)
      const surplus = balance - target;
      const amount = Math.floor(Math.min(surplus - 5, surplus / 1.01));
      res = transact("payment", tokens[customer], phone(customer), phone("merchant1"), amount, setupTags);
      if (!checkTransaction(res, "payment", TRANSACTION_APIS.payment.message, setupTags)) {
        fail(`Resetting ${customer} balance failed: ${res.status} ${res.body}`);
      }
    }
  }

  return { tokens };
}

export function runFlow(data) {
  const flow = FLOWS[exec.scenario.name];
  const res = transact(
    flow.api,
    data.tokens[flow.from],
    users[flow.from].phone_number,
    users[flow.to].phone_number,
    flow.amount,
  );
  const ok = checkTransaction(res, flow.api, TRANSACTION_APIS[flow.api].message, { phase: flow.phase });
  if (!ok && __ENV.DEBUG) {
    console.warn(`${exec.scenario.name}: ${res.status} ${res.body}`);
  }
}

// ---------------------------------------------------------------- reporting

const fmt = (n, digits = 2) => (n === undefined || n === null || Number.isNaN(n) ? "-" : Number(n).toFixed(digits));
const pct = (n) => (n === undefined ? "-" : `${(n * 100).toFixed(2)}%`);

function metric(data, name) {
  return data.metrics[name] ? data.metrics[name].values : undefined;
}

function statsRow(data, filter, activeSeconds) {
  const duration = metric(data, `http_req_duration{${filter}}`) || {};
  const reqs = metric(data, `http_reqs{${filter}}`) || {};
  const failed = metric(data, `http_req_failed{${filter}}`) || {};
  return [
    reqs.count ?? 0,
    fmt((reqs.count ?? 0) / activeSeconds),
    fmt(duration.avg),
    fmt(duration.med),
    fmt(duration["p(90)"]),
    fmt(duration["p(95)"]),
    fmt(duration["p(99)"]),
    fmt(duration.max),
    pct(failed.rate),
  ];
}

function apiComparisonMarkdown(data) {
  const header =
    "| Requests | Throughput (req/s) | Avg (ms) | Median (ms) | p90 (ms) | p95 (ms) | p99 (ms) | Max (ms) | Failed |";
  const divider = "|---:|---:|---:|---:|---:|---:|---:|---:|---:|";
  const lines = ["# API Comparison", "", `Arrival rate per flow: ${RATE} transactions/s`, ""];

  lines.push("## Overall (per API)", "", `| API | Active time ${header} Checks passed |`, `|---|---:${divider}---:|`);
  for (const api of Object.keys(TRANSACTION_APIS)) {
    const phasesWithApi = PHASES.filter((p) => p.flows.some((f) => f.api === api)).length;
    const checks = metric(data, `checks{kind:transaction,api:${api}}`) || {};
    const row = statsRow(data, `api:${api}`, phasesWithApi * PHASE_SECONDS);
    lines.push(`| ${api} | ${phasesWithApi * PHASE_SECONDS}s | ${row.join(" | ")} | ${pct(checks.rate)} |`);
  }

  lines.push("", "## Per phase", "", `| Phase | Concurrent flows | API ${header}`, `|---|---:|---${divider}`);
  for (const phase of PHASES) {
    for (const api of new Set(phase.flows.map((f) => f.api))) {
      const row = statsRow(data, `phase:${phase.id},api:${api}`, PHASE_SECONDS);
      lines.push(`| ${phase.id} (${phase.label}) | ${phase.flows.length} | ${api} | ${row.join(" | ")} |`);
    }
  }
  return lines.join("\n") + "\n";
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: " ", enableColors: true }),
    "reports/summary.txt": textSummary(data, { indent: " ", enableColors: false }),
    "reports/report.html": htmlReport(data, { title: "DMoney Transaction Load Test" }),
    "reports/summary.json": JSON.stringify(data, null, 2),
    "reports/api-comparison.md": apiComparisonMarkdown(data),
  };
}
