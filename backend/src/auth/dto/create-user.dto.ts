import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '../entities/user.entity';

export class CreateUserDto {
  @IsEmail()
  email: string;

  /**
   * 12 caracteres minimum. Le systeme peut immobiliser un camion :
   * la longueur du mot de passe n'est pas un detail cosmetique.
   */
  @IsString()
  @MinLength(12, { message: 'Le mot de passe doit faire au moins 12 caracteres' })
  @MaxLength(128)
  password: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @IsEnum(Role, { message: 'Role inconnu' })
  role: Role;
}

export class UpdateUserDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;
}
