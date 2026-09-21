import { Controller, Get, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { Public } from '../auth/decorators/public.decorator';
import { AuthService } from '../auth/auth.service';
import { setAuthCookies } from '../auth/auth.controller';
import { FleetService } from '../fleet/fleet.service';
import { ExitRequestsService } from '../fleet/exit-requests.service';
import { AlertsService } from '../rules/alerts.service';
import { MaintenanceService } from '../maintenance/maintenance.service';

/**
 * Integration au Portail Atlantic — meme contrat que les projets Symfony :
 *  - GET /api/stats        : synthese JSON, en-tete X-Api-Token = STATS_API_TOKEN, ?d1&d2 (YYYY-MM-DD)
 *  - GET /sso/login?token= : <b64url(payload)>.<b64url(HMAC-SHA256(payloadB64, SSO_SECRET))>
 *      payload { iss: 'portail-atlantic', sub: 'portal@atlantic.local', aud: 'geotruck', iat, exp }
 */
@Controller()
export class PortalController {
  private static readonly ISSUER = 'portail-atlantic';
  private static readonly SUBJECT = 'portal@atlantic.local';
  private static readonly AUDIENCE = 'geotruck';
  private static readonly LEEWAY = 5;

  constructor(
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly fleet: FleetService,
    private readonly exitRequests: ExitRequestsService,
    private readonly alerts: AlertsService,
    private readonly maintenance: MaintenanceService,
    private readonly db: DataSource,
  ) {}

  @Public()
  @Get('api/stats')
  async stats(@Req() req: Request, @Query('d1') d1?: string, @Query('d2') d2?: string) {
    const expected = (this.config.get<string>('STATS_API_TOKEN') ?? '').trim();
    const given = String(req.headers['x-api-token'] ?? '');
    if (expected.length === 0 || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
      throw new UnauthorizedException('Non autorisé');
    }

    const start = d1 && /^\d{4}-\d{2}-\d{2}$/.test(d1) ? `${d1} 00:00:00` : '2025-09-01 00:00:00';
    const end = d2 && /^\d{4}-\d{2}-\d{2}$/.test(d2) ? `${d2} 23:59:59` : new Date().toISOString().slice(0, 10) + ' 23:59:59';

    const vehicles = this.fleet.all();
    const [[trips], [expenses], [investments], [km]] = await Promise.all([
      this.db.query('SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM trips WHERE started_at BETWEEN ? AND ?', [start, end]),
      this.db.query('SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM vehicle_expenses WHERE at BETWEEN ? AND ?', [start, end]),
      this.db.query('SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM vehicle_investments WHERE at BETWEEN ? AND ?', [start, end]),
      this.db.query(
        'SELECT COALESCE(SUM(mx - mn),0) AS km FROM (SELECT vehicle_id, MAX(odometer) mx, MIN(odometer) mn FROM positions WHERE recorded_at BETWEEN ? AND ? GROUP BY vehicle_id) t',
        [start, end],
      ),
    ]);

    const alertsAll = this.alerts.recent(500).filter((a) => a.at >= new Date(start).toISOString() && a.at <= new Date(end).toISOString());
    const plans = this.maintenance.overview(vehicles);
    const pending = await this.exitRequests.openList();

    const revenue = Number(trips.total);
    const spent = Number(expenses.total);
    const invested = Number(investments.total);

    return {
      generatedAt: new Date().toISOString(),
      period: { d1: start.slice(0, 10), d2: end.slice(0, 10) },
      currency: 'MRU',
      fleet: {
        total: vehicles.length,
        moving: vehicles.filter((v) => v.speed >= 3).length,
        stopped: vehicles.filter((v) => v.speed < 3 && v.starter !== 'blocked').length,
        blocked: vehicles.filter((v) => v.starter === 'blocked').length,
        awaitingFirstPosition: vehicles.filter((v) => !v.updatedAt).length,
      },
      activity: { trips: Number(trips.n), km: Math.round(Number(km.km)) },
      finance: { revenue, expenses: spent, investments: invested, profitBeforeInvest: revenue - spent, net: revenue - spent - invested },
      pending: { loadsToValidate: pending.length, unlockRequests: vehicles.filter((v) => v.unlockRequested).length },
      alerts: { critical: alertsAll.filter((a) => a.level === 'critical').length, warning: alertsAll.filter((a) => a.level === 'warning').length, fuel: alertsAll.filter((a) => a.code.startsWith('fuel_')).length },
      maintenance: { overdue: plans.filter((p) => p.status === 'overdue').length, soon: plans.filter((p) => p.status === 'soon').length },
      vehicles: vehicles.map((v) => ({ id: v.id, plate: v.plate, driver: v.driver, speed: v.speed, starter: v.starter, odometer: v.odometer, fuel: v.fuelMain + v.fuelAux, lastSeen: v.updatedAt || null })),
    };
  }

  @Public()
  @Get('sso/login')
  async sso(@Query('token') token: string | undefined, @Req() req: Request, @Res() res: Response) {
    const secret = (this.config.get<string>('SSO_SECRET') ?? '').trim();
    const payload = this.verify(token ?? '', secret);
    if (payload === null) {
      res.status(403).send('Lien SSO invalide ou expiré.');
      return;
    }
    const email = (this.config.get<string>('SSO_USER_EMAIL') ?? 'admin@fleet.local').trim();
    const { tokens } = await this.auth.loginTrusted(email, { userAgent: req.headers['user-agent'], ip: req.ip });
    setAuthCookies(res, tokens);
    res.redirect(302, '/');
  }

  private verify(token: string, secret: string): Record<string, unknown> | null {
    if (secret.length === 0 || token.split('.').length !== 2) return null;
    const [payloadB64, sigB64] = token.split('.');
    const expected = createHmac('sha256', secret).update(payloadB64).digest();
    const given = Buffer.from(sigB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    } catch {
      return null;
    }
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== PortalController.ISSUER) return null;
    if (payload.sub !== PortalController.SUBJECT) return null;
    if (payload.aud !== PortalController.AUDIENCE) return null;
    if (Number(payload.iat ?? 0) > now + PortalController.LEEWAY) return null;
    if (Number(payload.exp ?? 0) < now - PortalController.LEEWAY) return null;
    return payload;
  }
}
