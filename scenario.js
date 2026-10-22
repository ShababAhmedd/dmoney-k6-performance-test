import http from "k6/http";
import { sleep } from "k6";
export let options = {
  scenarios: {
    sendMoney: {
      executor: "constant-vus",
      vus: 20000, // 20% of users sending money
      duration: "1h",
      exec: "sendMoney",
    },
    withdrawMoney: {
      executor: "constant-vus",
      vus: 10000, // 10% of users withdrawing money
      duration: "1h",
      exec: "withdrawMoney",
    },
    recharge: {
      executor: "constant-vus",
      vus: 50000, // 50% of users doing recharge
      duration: "1h",
      exec: "recharge",
    },
    merchantPayment: {
      executor: "constant-vus",
      vus: 10000, // 10% of users doing merchant payment
      duration: "1h",
      exec: "merchantPayment",
    },
    utilityPayment: {
      executor: "constant-vus",
      vus: 10000, // 10% of users doing utility payment
      duration: "1h",
      exec: "utilityPayment",
    },
  },
};
export function sendMoney() {
  http.post("https://bkash.com/sendMoney", {
    /* ... */
  });
  sleep(1);
}
export function withdrawMoney() {
  http.post("https://bkash.com/withdrawMoney", {
    /* ... */
  });
  sleep(1);
}
export function recharge() {
  http.post("https://bkash.com/recharge", {
    /* ... */
  });
  sleep(1);
}
export function merchantPayment() {
  http.post("https://bkash.com/merchantPayment", {
    /* ... */
  });
  sleep(1);
}
export function utilityPayment() {
  http.post("https://bkash.com/utilityPayment", {
    /* ... */
  });
  sleep(1);
}
