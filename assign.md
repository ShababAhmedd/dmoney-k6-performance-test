Assignment Scenario
Create a k6 performance test that simulates the following DMoney transaction activities for 2 minutes.

Test users:

Agent 1
Agent 2
Customer 1
Customer 2
Merchant 1
Merchant 2
Transaction Flow
0–30 seconds

Customer 1 sends money to Customer 2.
Customer 2 makes payments to Merchant 1.
30–60 seconds

Customer 2 sends money to Customer 1.
Agent 1 deposits money to Customer 2.
Customer 1 continues making payments to Merchant 1.
60–90 seconds

Agent 1 deposits money to Customer 1.
Agent 2 deposits money to Customer 2.
Customer 1 sends money to Customer 2.
Customer 2 makes payments to Merchant 2.
90–120 seconds

Agent 1 makes payments to Merchant 1.
Agent 2 makes payments to Merchant 2.
Customer 1 makes payments to Merchant 1.
Customer 2 makes payments to Merchant 2.
Use the following APIs:

/transaction/deposit
/transaction/sendmoney
/transaction/payment
Each user must authenticate using their own credentials. Transactions assigned to the same time period should execute concurrently and continue throughout that period.

After the test, compare the performance of the three transaction APIs and report their response time, throughput, failure rate, and any performance degradation observed as the transaction workload changes.

Assertions
Add appropriate k6 checks to validate each transaction response.

At minimum, verify:

Expected HTTP status code
Transaction request is successful
Transaction ID is returned
Expected success message is returned
Thresholds
Configure performance thresholds so that:

Failed request rate is less than 1%
p(95) response time is below 1000 ms
Transaction checks pass at least 99% of the time
Also define separate thresholds for Deposit, Send Money, and Payment APIs.

How to submit:
upload to github
Add proper readme
Generate html report
Upload screenshot in readme
Also share the metrix screenshot in readme
