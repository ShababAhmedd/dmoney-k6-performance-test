import http from "k6/http";
import { check, sleep } from "k6";

// export const options = {
//   iterations: 10,    // 10 virtual users continuously making HTTP requests for 10s
//     // vus: 10,
//     // duration: "10s",
// };

export const options = {
  stages: [
    { duration: "10s", target: 200 }, // 50 virtual visits site within 10 second
    { duration: "20s", target: 50 }, // stay at 200 users for 30 second
    { duration: "10s", target: 0 }, // ramp down to 0 users withing next 10 second
  ],

  thresholds: {
    // Ensure 99% of requests complete under 500ms
    http_req_duration: ["p(99) < 500"],

    // Fail test if more than 1% of requests fail
    http_req_failed: ["rate<0.01"],
  },
};

// The default exported function is gonna be picked up by k6 as the entry point for the test script. It will be executed repeatedly in "iterations" for the whole duration of the test.
export default function () {
  // Make a GET request to the target URL
  //   http.get("https://test-api.k6.io");
  let res = http.get("https://test-api.k6.io", {
    tags: { endpoint: "unknown api call" },
  });

  check(res, {
    "status is 200": (r) => r.status === 200,
    "response time < 500ms": (r) => r.timings.duration < 500,
  });

  // Sleep for 1 second to simulate real-world usage
  sleep(1);
}
