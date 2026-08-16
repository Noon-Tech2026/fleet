import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ENTITIES } from './entities';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql' as const,
        host: config.get<string>('DB_HOST', 'localhost'),
        port: Number(config.get<string>('DB_PORT', '3306')),
        username: config.getOrThrow<string>('DB_USER'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME', 'fleet'),
        entities: ENTITIES,
        charset: 'utf8mb4',
        timezone: 'Z',

        /**
         * synchronize cree et modifie les tables automatiquement.
         * Pratique en developpement, dangereux en production : une
         * modification d'entite peut supprimer une colonne et ses donnees.
         * A remplacer par des migrations TypeORM avant la mise en service.
         */
        synchronize: config.get<string>('NODE_ENV') !== 'production',
        logging: config.get<string>('DB_LOGGING') === 'true',
      }),
    }),
  ],
})
export class DatabaseModule {}
