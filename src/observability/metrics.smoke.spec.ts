import { MetricsService } from './metrics.service';

describe('metrics smoke', () => {
  it('exposes core series after activity', async () => {
    const svc = new MetricsService();
    svc.httpRequests.inc({ method: 'GET', route: '/jobs', status: '200' });
    svc.httpDuration.observe({ method: 'GET', route: '/jobs', status: '200' }, 0.03);
    const body = await svc.scrape();
    expect(body).toContain('http_requests_total');
    expect(body).toContain('http_request_duration_seconds');
    expect(body).toContain('verification_process_cpu');
  });
});
