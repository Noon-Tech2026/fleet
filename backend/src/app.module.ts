import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';

import { CommandLog } from './auth/entities/command-log.entity';
import { Vehicle } from './fleet/entities/vehicle.entity';
import { Position } from './fleet/entities/position.entity';
import { Departure } from './fleet/entities/departure.entity';
import { Zone } from './geofence/entities/zone.entity';
import { FuelCalibration } from './fuel/entities/fuel-calibration.entity';

import { EventsModule } from './events/events.module';
import { EventsController } from './events/events.controller';
import { TelemetryModule } from './telemetry/telemetry.module';
import { FleetService } from './fleet/fleet.service';
import { FleetController } from './fleet/fleet.controller';
import { FleetAdminController } from './fleet/fleet-admin.controller';
import { VehiclesService } from './fleet/vehicles.service';
import { PositionsService } from './fleet/positions.service';
import { DeparturesService } from './fleet/departures.service';
import { GeofenceService } from './geofence/geofence.service';
import { FuelService } from './fuel/fuel.service';
import { RulesService } from './rules/rules.service';
import { AlertsService } from './rules/alerts.service';
import { ImmobilizerService } from './immobilizer/immobilizer.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    UsersModule,
    TypeOrmModule.forFeature([CommandLog, Vehicle, Position, Departure, Zone, FuelCalibration]),
    EventsModule,
    TelemetryModule,
  ],
  controllers: [FleetController, FleetAdminController, EventsController],
  providers: [
    FleetService,
    VehiclesService,
    PositionsService,
    DeparturesService,
    GeofenceService,
    FuelService,
    RulesService,
    AlertsService,
    ImmobilizerService,

    // Ordre significatif : on identifie l'utilisateur (JwtAuthGuard)
    // avant de verifier son role (RolesGuard).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
