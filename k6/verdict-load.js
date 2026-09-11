import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '2m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: { http_req_duration: ['p(95)<500'] },
};

const BASE = __ENV.BASE_URL || 'http://localhost:3002';

export default function () {
  const jobs = http.get(`${BASE}/jobs`);
  check(jobs, { 'jobs 200': (r) => r.status === 200 });
  const verdict = http.post(`${BASE}/verdicts`, JSON.stringify({ jobId: 'load-test', result: 'pass' }), { headers: { 'Content-Type': 'application/json' } });
  check(verdict, { 'verdict accepted': (r) => r.status === 201 || r.status === 202 });
  sleep(1);
}
