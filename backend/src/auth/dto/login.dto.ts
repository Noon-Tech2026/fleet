import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Adresse email invalide' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Mot de passe trop court' })
  @MaxLength(128)
  password: string;
}
