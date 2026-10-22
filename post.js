import http from "k6/http";
import { check, sleep } from "k6";

const base_url = "https://dmoney.roadtocareer.net";

export const options = {
  vus: 1,
  duration: "1s",
};

export default function () {
  const loginPayload = JSON.stringify({
    email: "admin@dmoney.com",
    password: "1234",
  });

  const loginHeaders = {
    "Content-Type": "application/json",
  };

  const loginRes = http.post(`${base_url}/user/login`, loginPayload, {
    headers: loginHeaders,
  });

  // Check login response
  check(loginRes, {
    "login status is 200": (r) => r.status === 200,
    "login token is present": (r) => r.json("token") !== undefined,
  });

  const token = loginRes.json("token");
  console.log("Login Token:", token);

  // 2. Now call User Search API with Authorization header
  const searchHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const searchRes = http.get(`${base_url}/user/search/id/104390`, {
    headers: searchHeaders,
  });

  // Check search API response
  check(searchRes, {
    "search status is 200": (r) => r.status === 200,
    "user found": (r) => r.body.includes("104390"),
  });

  sleep(1);
}
