import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const route = req.route?.path ?? req.url;
    const end = this.metrics.httpDuration.startTimer({ method: req.method, route });
    return next.handle().pipe(
      tap({
        next: () => this.done(req, res, route, end),
        error: () => this.done(req, res, route, end),
      }),
    );
  }

  private done(req: any, res: any, route: string, end: (labels?: Record<string, string | number>) => void): void {
    const status = String(res.statusCode ?? 0);
    end({ status });
    this.metrics.httpRequests.inc({ method: req.method, route, status });
  }
}
