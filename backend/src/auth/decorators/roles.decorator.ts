import { SetMetadata } from '@nestjs/common';
import { Role } from '../entities/user.entity';

export const REQUIRED_ROLE = 'requiredRole';

/** Role MINIMUM requis. Les roles superieurs passent aussi. */
export const RequireRole = (role: Role) => SetMetadata(REQUIRED_ROLE, role);
