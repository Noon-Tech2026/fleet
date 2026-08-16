import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Role, hasAtLeast } from '../entities/user.entity';
import { REQUIRED_ROLE } from '../decorators/roles.decorator';
import { JwtPayload } from '../auth.service';

/**
 * Verifie le role MINIMUM exige par la route.
 * Hierarchie : viewer < operator < supervisor < admin.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role>(REQUIRED_ROLE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Acces refuse');

    if (!hasAtLeast(user.role, required)) {
      throw new ForbiddenException(
        `Action reservee au role ${required} ou superieur (vous etes ${user.role})`,
      );
    }
    return true;
  }
}
