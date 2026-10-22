import http from "k6/http";
import { check, group, sleep } from "k6";
export const options = {
  vus: 10,
  duration: "5s",
  thresholds: {
    "http_req_duration{endpoint:listData}": ["p(95)<1000"],
    "http_req_duration{endpoint:getItem}": ["p(95)<1000"],
  },
};

export default function () {
  group("📦 List Data API", function () {
    const listDataRes = http.get("https://jsonplaceholder.typicode.com/posts", {
      tags: { endpoint: "listData" },
    });
    check(listDataRes, {
      "✅ All list API request successful": (r) => r.status === 200,
    });
  });

  group("📦 Get Single Item API", function () {
    const getDataRes = http.get(
      "https://jsonplaceholder.typicode.com/posts/1",
      { tags: { endpoint: "getItem" } },
    );
    check(getDataRes, {
      "✅ Get item data request successful": (r) => r.status === 200,
    });
  });

  sleep(1);
}
