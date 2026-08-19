import { Body, Controller, Get, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService, JwtPayload, TokenPair } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from './decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from './decorators/current-user.decorator';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './guards/jwt-auth.guard';
import { toPublic } from './entities/user.entity';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.login(dto.email, dto.password, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    setAuthCookies(res, tokens);
    return user;
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('Aucune session');

    const { user, tokens } = await this.auth.refresh(token, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    setAuthCookies(res, tokens);
    return user;
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearAuthCookies(res);
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() payload: JwtPayload) {
    const user = await this.auth.findById(payload.sub);
    if (!user) throw new UnauthorizedException();
    return toPublic(user);
  }
}

/**
 * Cookies httpOnly : le jeton n'est jamais lisible en JavaScript, donc
 * une faille XSS dans le dashboard ne permet pas de voler une session.
 *
 * sameSite 'strict' sert de protection CSRF : aucun site tiers ne peut
 * declencher un blocage de demarreur en faisant cliquer l'exploitant
 * sur un lien.
 */
function setAuthCookies(res: Response, tokens: TokenPair): void {
  const secure = process.env.NODE_ENV === 'production';

  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: tokens.accessMaxAge,
    path: '/',
  });

  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: tokens.refreshMaxAge,
    path: '/api/auth',
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}
