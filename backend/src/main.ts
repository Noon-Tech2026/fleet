import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());

  // credentials: true est indispensable — l'authentification passe par
  // des cookies httpOnly, pas par un en-tete Authorization.
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  const log = new Logger('Bootstrap');
  log.log(`API sur http://localhost:${port}`);
  log.log(`Source de telemetrie : ${process.env.TELEMETRY_SOURCE ?? 'simulator'}`);
  log.log(`Base MySQL : ${process.env.DB_HOST ?? 'localhost'}/${process.env.DB_NAME ?? 'fleet'}`);
}

void bootstrap();
