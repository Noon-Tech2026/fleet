import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, Role, PublicUser, toPublic } from '../auth/entities/user.entity';
import { AuthService } from '../auth/auth.service';
import { CreateUserDto, UpdateUserDto } from '../auth/dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly auth: AuthService,
  ) {}

  async list(): Promise<PublicUser[]> {
    const users = await this.repo.find({ order: { createdAt: 'ASC' } });
    return users.map(toPublic);
  }

  async create(dto: CreateUserDto): Promise<PublicUser> {
    const email = dto.email.toLowerCase().trim();
    if (await this.repo.findOne({ where: { email } })) {
      throw new BadRequestException('Cette adresse est deja utilisee');
    }

    const user = this.repo.create({
      email,
      fullName: dto.fullName.trim(),
      role: dto.role,
      passwordHash: await AuthService.hashPassword(dto.password),
      active: true,
    });
    return toPublic(await this.repo.save(user));
  }

  async update(id: string, dto: UpdateUserDto, actorId: string): Promise<PublicUser> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur inconnu');

    // Un administrateur ne peut ni se retrograder ni se desactiver :
    // c'est la porte de sortie classique vers un systeme sans admin.
    if (user.id === actorId && (dto.role !== undefined || dto.active === false)) {
      throw new ForbiddenException('Vous ne pouvez pas modifier votre propre role ni vous desactiver');
    }

    if (dto.role !== undefined) user.role = dto.role;
    if (dto.fullName !== undefined) user.fullName = dto.fullName.trim();

    if (dto.active !== undefined) {
      user.active = dto.active;
      // Desactiver un compte doit couper ses sessions immediatement,
      // sinon le jeton d'acces reste valide jusqu'a 15 minutes.
      if (!dto.active) await this.auth.revokeAllForUser(user.id);
    }

    return toPublic(await this.repo.save(user));
  }

  async resetPassword(id: string, password: string): Promise<{ ok: true }> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur inconnu');
    if (password.length < 12) throw new BadRequestException('Mot de passe trop court');

    user.passwordHash = await AuthService.hashPassword(password);
    await this.repo.save(user);
    await this.auth.revokeAllForUser(user.id);
    return { ok: true };
  }

  async countAdmins(): Promise<number> {
    return this.repo.count({ where: { role: Role.Admin, active: true } });
  }
}
