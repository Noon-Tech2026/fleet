import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Rôles, du moins au plus permissif. L'ordre du tableau ROLE_RANK fait foi :
 * un rôle donne accès à tout ce qu'autorisent les rôles inférieurs.
 */
export enum Role {
  Viewer = 'viewer', // consultation seule
  Operator = 'operator', // + confirmation de départ
  Supervisor = 'supervisor', // + blocage et réautorisation du démarreur
  Admin = 'admin', // + gestion des comptes
}

export const ROLE_RANK: Role[] = [Role.Viewer, Role.Operator, Role.Supervisor, Role.Admin];

export function hasAtLeast(userRole: Role, required: Role): boolean {
  return ROLE_RANK.indexOf(userRole) >= ROLE_RANK.indexOf(required);
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 190 })
  email: string;

  /** Jamais exposé par l'API — voir toPublic(). */
  @Column({ name: 'password_hash', length: 255, select: false })
  passwordHash: string;

  @Column({ name: 'full_name', length: 120 })
  fullName: string;

  @Column({ type: 'enum', enum: Role, default: Role.Viewer })
  role: Role;

  @Column({ default: true })
  active: boolean;

  @Column({ name: 'last_login_at', type: 'datetime', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
}

export function toPublic(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    active: user.active,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}
