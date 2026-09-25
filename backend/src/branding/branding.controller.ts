import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Marque de l'instance (nom, slogan, logo) : lue dans l'environnement, pour
 * que le meme build serve chaque client sous son propre nom.
 *   BRAND_NAME=GAT TRUCK   BRAND_TAGLINE=Your fleet under control   BRAND_LOGO=/app/branding/logo.png
 */
@Controller('api/branding')
export class BrandingController {
  constructor(private readonly config: ConfigService) {}

  @Public()
  @Get()
  branding() {
    const logoPath = this.config.get<string>('BRAND_LOGO') ?? '';
    return {
      name: (this.config.get<string>('BRAND_NAME') ?? 'GeoTruck').trim(),
      tagline: (this.config.get<string>('BRAND_TAGLINE') ?? 'Your fleet under control').trim(),
      logo: logoPath && existsSync(logoPath) ? '/api/branding/logo' : '/logo.png',
    };
  }

  @Public()
  @Get('logo')
  logo(@Res() res: Response) {
    const logoPath = this.config.get<string>('BRAND_LOGO') ?? '';
    if (logoPath && existsSync(logoPath)) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.sendFile(resolve(logoPath));
    } else {
      res.redirect(302, '/logo.png');
    }
  }
}
