import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { User, Role, PublicUser, toPublic } from './entities/user.entity';
import { RefreshSession } from './entities/refresh-session.entity';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessMaxAge: number;
  refreshMaxAge: number;
}

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 7 * 24 * 3600;
const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(RefreshSession) private readonly sessions: Repository<RefreshSession>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(
    email: string,
    password: string,
    context: { userAgent?: string; ip?: string },
  ): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email: email.toLowerCase().trim() })
      .getOne();

    // Message identique dans tous les cas d'echec : ne jamais reveler
    // si l'adresse existe, sinon on offre un annuaire de comptes valides.
    const generic = new UnauthorizedException('Identifiants invalides');

    if (!user) {
      // Comparaison a vide pour garder un temps de reponse constant.
      await bcrypt.compare(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
      throw generic;
    }
    if (!user.active) throw generic;
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      this.log.warn(`Echec de connexion pour ${user.email}`);
      throw generic;
    }

    user.lastLoginAt = new Date();
    await this.users.save(user);

    const tokens = await this.issue(user, context);
    this.log.log(`Connexion : ${user.email} (${user.role})`);
    return { user: toPublic(user), tokens };
  }

  /**
   * Rotation : l'ancienne session est revoquee et remplacee.
   * Si un jeton deja revoque est presente, toutes les sessions de
   * l'utilisateur sont coupees — c'est le signe d'un vol de jeton.
   */
  async refresh(
    rawToken: string,
    context: { userAgent?: string; ip?: string },
  ): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const tokenHash = hash(rawToken);
    const session = await this.sessions.findOne({ where: { tokenHash } });

    if (!session) throw new UnauthorizedException('Session inconnue');

    if (session.revokedAt) {
      this.log.error(`Jeton revoque rejoue pour l'utilisateur ${session.userId} — sessions coupees`);
      await this.revokeAllForUser(session.userId);
      throw new UnauthorizedException('Session compromise, reconnectez-vous');
    }

    if (session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session expiree');
    }

    const user = await this.users.findOne({ where: { id: session.userId } });
    if (!user || !user.active) throw new UnauthorizedException('Compte desactive');

    session.revokedAt = new Date();
    await this.sessions.save(session);

    const tokens = await this.issue(user, context);
    return { user: toPublic(user), tokens };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const session = await this.sessions.findOne({ where: { tokenHash: hash(rawToken) } });
    if (session && !session.revokedAt) {
      session.revokedAt = new Date();
      await this.sessions.save(session);
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.sessions.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  async verifyAccessToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Jeton invalide ou expire');
    }
  }

  async findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  static hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  private async issue(
    user: User,
    context: { userAgent?: string; ip?: string },
  ): Promise<TokenPair> {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_SECRET'),
      expiresIn: ACCESS_TTL_SECONDS,
    });

    const refreshToken = randomBytes(48).toString('base64url');

    await this.sessions.save(
      this.sessions.create({
        userId: user.id,
        tokenHash: hash(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
        userAgent: context.userAgent?.slice(0, 255) ?? null,
        ipAddress: context.ip?.slice(0, 64) ?? null,
      }),
    );

    return {
      accessToken,
      refreshToken,
      accessMaxAge: ACCESS_TTL_SECONDS * 1000,
      refreshMaxAge: REFRESH_TTL_SECONDS * 1000,
    };
  }
}

/** SHA-256 suffit ici : le jeton est deja 48 octets aleatoires. */
function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
