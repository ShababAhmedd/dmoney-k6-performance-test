import http from "k6/http";
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";

export let options = {
  vus: 100, // 10 virtual users continuously making HTTP requests
  duration: "10s",
  iterations: 100,
};

export default function () {
  http.get("http://localhost:3000");
}
export function handleSummary(data) {
  return {
    "./reports/report.html": htmlReport(data),
  };
}
