# DMoney Transaction Load Test (k6)

A k6 performance test for the DMoney transaction API. It replays a 2-minute workload of deposits, send-money transfers and merchant payments between six users. It then compares how the three transaction APIs behave as the workload changes.

- **Test script:** [dmoney-transactions.test.js](dmoney-transactions.test.js)
- **HTML report:** [reports/report.html](reports/report.html) (k6-reporter), plus [reports/dashboard.html](reports/dashboard.html) (k6 web dashboard with time-series graphs)
- **API comparison:** [reports/api-comparison.md](reports/api-comparison.md), generated automatically after every run

---

## Scenario

Six users: **Agent 1, Agent 2, Customer 1, Customer 2, Merchant 1, Merchant 2**. Every user logs in with their own credentials.

| Time | Flows running concurrently | APIs used |
|---|---|---|
| **0–30 s** (P1) | Customer 1 → Customer 2 send money<br>Customer 2 → Merchant 1 payment | sendmoney, payment |
| **30–60 s** (P2) | Customer 2 → Customer 1 send money<br>Agent 1 → Customer 2 deposit<br>Customer 1 → Merchant 1 payment | sendmoney, deposit, payment |
| **60–90 s** (P3) | Agent 1 → Customer 1 deposit<br>Agent 2 → Customer 2 deposit<br>Customer 1 → Customer 2 send money<br>Customer 2 → Merchant 2 payment | deposit ×2, sendmoney, payment |
| **90–120 s** (P4) | Agent 1 → Merchant 1 payment<br>Agent 2 → Merchant 2 payment<br>Customer 1 → Merchant 1 payment<br>Customer 2 → Merchant 2 payment | payment ×4 |

### How it is modelled

- Each flow is its own k6 **scenario** using the `constant-arrival-rate` executor. A flow sends **5 transactions/s** (configurable with `RATE`) for 30 s, and its `startTime` places it in its phase. All flows in a phase start together and run for the whole window.
- With an arrival-rate executor, the request rate stays fixed even if the server slows down. Any latency change between phases therefore comes from the server.
- Total load is **10 tx/s** in P1, **15 tx/s** in P2, and **20 tx/s** in P3 and P4.
- Every request is tagged with `api` (`deposit` / `sendmoney` / `payment`) and `phase` (`p1`–`p4`). These tags drive the per-API thresholds and the per-phase comparison.

### Authentication

`setup()` logs every user in with their own phone number and password:

1. `POST /user/login`
2. `POST /user/verify-otp?env=dev` with the backend's dev OTP (`0000`), which returns the JWT

Each flow then sends its requests with the token of the user who owns the `from_account`. The backend rejects a transaction whose token does not belong to the sender.

### Test data reset

The backend enforces balance checks and a 10,000 tk customer balance cap on deposits. Before every run, `setup()` resets the accounts to the same state:

| Account | Opening balance | Funded by |
|---|---|---|
| Agent 1, Agent 2 | 30,000 tk | SYSTEM → Agent deposit |
| Customer 1 | 7,000 tk | Agent 1 → Customer deposit (or a payment if above target) |
| Customer 2 | 5,000 tk | Agent 1 → Customer deposit (or a payment if above target) |

These balances are sized for `RATE=5`, so no account runs dry and no customer hits the deposit cap during the run. The test is therefore repeatable. Setup traffic is tagged `api:setup` and is left out of the per-API results.

---

## Assertions (checks)

Every transaction response is checked for:

| Check | Rule |
|---|---|
| Expected HTTP status code | `status === 201` |
| Transaction request is successful | message contains "successful" (and status 201) |
| Transaction ID is returned | `trnxId` is a non-empty string |
| Expected success message | exact match: `Deposit successful` / `Send money successful` / `Payment successful` |

The backend returns **208** for business errors such as insufficient balance. k6 does not count 208 as a failed request, so the status and message checks are what catch those cases.

## Thresholds

| Scope | Threshold |
|---|---|
| All requests | `http_req_failed` rate < 1% |
| All requests | `http_req_duration` p(95) < 1000 ms |
| All transactions | `checks{kind:transaction}` rate > 99% |
| **Deposit** | `http_req_duration{api:deposit}` p(95) < 1000 ms, p(99) < 1500 ms; `http_req_failed{api:deposit}` < 1%; `checks{kind:transaction,api:deposit}` > 99% |
| **Send Money** | same three rules on `api:sendmoney` |
| **Payment** | same three rules on `api:payment` |
| Per phase × API | p(95) < 1000 ms and failed < 1% (for example `http_req_duration{phase:p3,api:deposit}`), used to spot degradation |

---

## Project structure

```
.
├── dmoney-transactions.test.js   # main k6 test (scenarios, thresholds, setup, reporting)
├── lib/api.js                    # login, transaction requests, checks
├── scripts/create-users.mjs      # creates + activates the 6 test users via the admin API
├── data/users.example.json       # shape of data/users.json (the real file is git-ignored)
├── run-test.sh                   # runs the test and exports all reports
├── reports/                      # report.html, dashboard.html, summary.json/txt, api-comparison.md
└── screenshots/                  # screenshots used in this README
```

`exp1.js`, `grouping.js`, `html_report.js`, `post.js` and `scenario.js` are earlier k6 practice scripts and are not part of this test.

## How to run

**Prerequisites:** [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) (tested with v2.3.0), Node.js 18+, and the DMoney backend running (default `http://localhost:5000`) with the `Transactions.account` index in place (see [Backend fix](#backend-fix-deadlocks-under-concurrent-load)). Without it the backend deadlocks under this workload and the thresholds fail.

```bash
# 0. (backend repo, once per database) add the index the balance locks rely on
node migrations/add_account_index_to_transactions.js

# 1. Create the 6 test users (once per environment). Users get random names, phone
#    numbers and NIDs, a +alias Gmail address, password 1234, and are activated.
node scripts/create-users.mjs

# 2. Run the 2-minute test (writes everything into ./reports)
./run-test.sh
```

Optional environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `BASE_URL` | `http://localhost:5000` | backend URL |
| `RATE` | `5` | transactions per second for each flow |
| `PHASE_SECONDS` | `30` | length of each phase (use 5 for a quick smoke run) |
| `SYSTEM_LOGIN` / `SYSTEM_PASSWORD` | `system@dmoney.com` / `1234` | SYSTEM account that funds the agents |
| `PARTNER_KEY` | `ROADTOSDET` | `X-AUTH-SECRET-KEY` header value |
| `DEBUG` | – | set to `1` to log the body of every failed transaction |

Example: `PHASE_SECONDS=5 RATE=2 ./run-test.sh` runs a quick smoke test.

> Note: each login of an Agent, Customer or Merchant makes the backend email an OTP to that user's Gmail address. The test logs in once per user per run.

---

## Results

Run on 2026-10-23 against a local backend (Node/Express + MySQL 8), at `RATE=5`, for 2 minutes. 1,979 requests were sent: 1,959 measured transactions plus 20 setup requests (logins, balance lookups, opening-balance deposits). k6 dropped no iterations, and **every threshold passed** (k6 exit code 0).

### Screenshots

**HTML report (k6-reporter)** – [reports/report.html](reports/report.html)

![HTML report](screenshots/html-report.png)

**Terminal metrics (end-of-test summary)**

![Terminal metrics](screenshots/terminal-metrics.png)

**k6 web dashboard (time series)** – [reports/dashboard.html](reports/dashboard.html)

![Web dashboard](screenshots/web-dashboard.png)

### Threshold outcome

| Threshold | Limit | Result |
|---|---|---|
| Failed request rate (all requests) | < 1% | ✅ 0.00% |
| p(95) response time (all requests) | < 1000 ms | ✅ 85.07 ms |
| Transaction checks passed | > 99% | ✅ 100.00% (7,848 / 7,848) |
| **Deposit**: p95 / p99 / failed / checks | 1000 ms / 1500 ms / 1% / 99% | ✅ 93.53 ms / 115.67 ms / 0.00% / 100% |
| **Send Money**: p95 / p99 / failed / checks | 1000 ms / 1500 ms / 1% / 99% | ✅ 72.47 ms / 82.44 ms / 0.00% / 100% |
| **Payment**: p95 / p99 / failed / checks | 1000 ms / 1500 ms / 1% / 99% | ✅ 75.12 ms / 85.95 ms / 0.00% / 100% |
| Every phase × API: p95 / failed | 1000 ms / 1% | ✅ worst p95 97.38 ms (P3 deposit), 0.00% everywhere |

### API comparison (overall)

Throughput is measured over the time each API was actually active.

| API | Active time | Requests | Throughput | Avg | Median | p90 | p95 | p99 | Max | Failed | Checks passed |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Deposit | 60 s | 452 | 7.53 req/s | 76.14 ms | 75.93 ms | 89.56 ms | 93.53 ms | 115.67 ms | 148.44 ms | 0.00% | 100.00% |
| Send Money | 90 s | 452 | 5.02 req/s | 58.48 ms | 58.29 ms | 70.04 ms | 72.47 ms | 82.44 ms | 122.18 ms | 0.00% | 100.00% |
| Payment | 120 s | 1055 | 8.79 req/s | 57.30 ms | 56.58 ms | 69.73 ms | 75.12 ms | 85.95 ms | 126.86 ms | 0.00% | 100.00% |

### Per phase

| Phase | Total load | API | Requests | Throughput | Avg | p95 | p99 | Max | Failed |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| P1 (0–30 s) | 10 tx/s | sendmoney | 151 | 5.03 req/s | 52.39 ms | 61.49 ms | 64.84 ms | 67.88 ms | 0.00% |
| P1 (0–30 s) | 10 tx/s | payment | 150 | 5.00 req/s | 58.56 ms | 70.34 ms | 76.87 ms | 84.45 ms | 0.00% |
| P2 (30–60 s) | 15 tx/s | sendmoney | 151 | 5.03 req/s | 61.18 ms | 73.14 ms | 78.73 ms | 91.03 ms | 0.00% |
| P2 (30–60 s) | 15 tx/s | deposit | 151 | 5.03 req/s | 73.41 ms | 88.09 ms | 94.60 ms | 148.44 ms | 0.00% |
| P2 (30–60 s) | 15 tx/s | payment | 151 | 5.03 req/s | 55.57 ms | 69.56 ms | 74.88 ms | 75.75 ms | 0.00% |
| P3 (60–90 s) | 20 tx/s | deposit | 301 | 10.03 req/s | 77.50 ms | 97.38 ms | 122.19 ms | 138.19 ms | 0.00% |
| P3 (60–90 s) | 20 tx/s | sendmoney | 150 | 5.00 req/s | 61.91 ms | 77.92 ms | 88.71 ms | 122.18 ms | 0.00% |
| P3 (60–90 s) | 20 tx/s | payment | 151 | 5.03 req/s | 69.68 ms | 86.30 ms | 92.89 ms | 126.86 ms | 0.00% |
| P4 (90–120 s) | 20 tx/s | payment | 603 | 20.10 req/s | 54.32 ms | 67.68 ms | 76.87 ms | 91.63 ms | 0.00% |

### Analysis

**Response time.** All three APIs are far inside the 1 s target: the worst p95 of any API in any phase was 97 ms. **Deposit is the slowest API** (avg 76 ms, p95 94 ms). It locks and reads two balances (the agent's and the customer's) and checks the customer balance cap. Send money (avg 58 ms) and payment (avg 57 ms) lock only the payer's balance, and they perform about the same.

**Throughput.** The server kept up with the requested arrival rate in every phase. Every flow delivered 5 req/s (150–151 requests per 30 s), the two P3 deposit flows together delivered 10 req/s, and the four P4 payment flows delivered 20.1 req/s. No iterations were dropped. Throughput was never the bottleneck.

**Failure rate.** 0 of 1,979 requests failed, and all 7,848 transaction checks passed (status 201, success, `trnxId`, exact message).

**Degradation as the workload changes.** Latency rises in phases where different transaction types hit the **same accounts** at the same time, not simply when the request rate is highest:

- Send money p95 went from 61 ms (P1) to 73 ms (P2) and 78 ms (P3), **+27%**.
- Payment p95 went from 70 ms (P1, P2) to 86 ms (P3), **+23%**.
- Deposit p95 went from 88 ms (P2) to 97 ms (P3), when the deposit rate doubled.
- P4 runs at the same 20 tx/s as P3 but has the **lowest** payment latency of the run (p95 68 ms). Its four payments come from four different payers, so they never wait on each other's row locks.

In P3, Customer 1 and Customer 2 are each locked by a deposit, a send money and a payment at the same time. Those requests queue behind each other's `SELECT … FOR UPDATE` on the same balance rows, and that queueing is what shows up as the P3 latency increase. The k6 web dashboard shows the same shape: p95 climbs from 30 s, peaks around 60–90 s and drops back when the workload switches to independent payments at 90 s.

### Backend fix: deadlocks under concurrent load

The first run (2026-10-22, same script and settings) breached 13 thresholds. **14.04%** of requests failed with HTTP 500 `"Deadlock found when trying to get lock; try restarting transaction"`, all of them in P2 and P3. At this point the test was correct and the backend had a real concurrency bug.

**Root cause.** All three transaction controllers lock the payer's running balance with:

```sql
SELECT COALESCE(SUM(credit) - SUM(debit), 0) FROM Transactions WHERE account = ? FOR UPDATE
```

The `Transactions` table had **no index on `account`** (only the primary key). So every locking read scanned, and locked as it went, the whole primary index (about 7,500 rows). Transactions on *unrelated* accounts therefore blocked each other. A deposit, which takes two of these locks, formed lock cycles with concurrent transfers, and InnoDB aborted one side of each cycle.

**Fix** (in the backend repository):

- `migrations/add_account_index_to_transactions.js` is an idempotent migration that runs `ALTER TABLE Transactions ADD INDEX idx_transactions_account (account)`.
- `sequelizeModel/Transactions.js` declares the same index, so new databases get it from `sequelize.sync()`.

With the index, `EXPLAIN` shows the locking read as a `ref` lookup on `idx_transactions_account`, so it locks only that account's rows. The lock order is then cycle-free. Send money and payment lock only the payer. Deposit locks agent, then customer, and no transaction holds a customer lock while waiting for an agent. No controller code had to change.

| Metric | Before fix (2026-10-22) | After fix (2026-10-23) |
|---|---:|---:|
| Failed requests | 14.04% | **0.00%** |
| Transaction checks passed | 85.83% | **100.00%** |
| p95 response time (all requests) | 122.88 ms | **85.07 ms** |
| Avg response time (all requests) | 77.23 ms | **61.37 ms** |
| Breached thresholds | 13 | **0** |
| k6 exit code | 99 | **0** |

**Further recommendations for the backend**

1. Retry on `ER_LOCK_DEADLOCK` (or `ER_LOCK_WAIT_TIMEOUT`) on the server side instead of returning 500 to the client.
2. Balances are recomputed by summing the full ledger on every transaction. That cost grows with each row (2–3 rows per transaction). A per-account balance snapshot or a covering index on `(account, credit, debit)` would keep balance reads constant-time as the table grows.
