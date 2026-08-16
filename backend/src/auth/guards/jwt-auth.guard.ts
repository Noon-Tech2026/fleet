import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService } from '../auth.service';
import { IS_PUBLIC } from '../decorators/public.decorator';

export const ACCESS_COOKIE = 'fleet_access';
export const REFRESH_COOKIE = 'fleet_refresh';

/**
 * Garde appliquee GLOBALEMENT : toute route est protegee par defaut,
 * il faut un @Public() explicite pour l'ouvrir. L'inverse — proteger
 * route par route — finit toujours par laisser un trou.
 *
 * Le jeton est lu dans un cookie httpOnly en priorite. C'est ce qui
 * permet a EventSource (le flux SSE) de s'authentifier : l'API du
 * navigateur n'autorise pas d'en-tete Authorization personnalise.
 * L'en-tete reste accepte pour les appels serveur a serveur et les tests.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractToken(request);
    if (!token) throw new UnauthorizedException('Authentification requise');

    const payload = await this.auth.verifyAccessToken(token);

    // Le jeton peut etre encore valide alors que le compte vient d'etre
    // desactive. On revalide en base : 15 minutes de fenetre pour un
    // systeme qui coupe des demarreurs, c'est trop.
    const user = await this.auth.findById(payload.sub);
    if (!user || !user.active) throw new UnauthorizedException('Compte desactive');

    // Le role fait foi cote base, pas cote jeton : une retrogradation
    // prend effet immediatement.
    (request as Request & { user: typeof payload }).user = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return true;
  }
}

function extractToken(request: Request): string | null {
  const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
  if (cookies?.[ACCESS_COOKIE]) return cookies[ACCESS_COOKIE];

  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);

  return null;
}
