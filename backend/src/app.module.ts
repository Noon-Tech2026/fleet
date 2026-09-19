import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { MaintenancePlan } from './maintenance/entities/maintenance-plan.entity';
import { MaintenanceLog } from './maintenance/entities/maintenance-log.entity';
import { Client } from './accounting/entities/client.entity';
import { Driver } from './accounting/entities/driver.entity';
import { Trip } from './accounting/entities/trip.entity';
import { TripContainer } from './accounting/entities/trip-container.entity';
import { VehicleExpense } from './accounting/entities/vehicle-expense.entity';
import { VehicleInvestment } from './accounting/entities/vehicle-investment.entity';

import { EventsModule } from './events/events.module';
import { EventsController } from './events/events.controller';
import { TelemetryModule } from './telemetry/telemetry.module';
import { FleetService } from './fleet/fleet.service';
import { FleetController } from './fleet/fleet.controller';
import { FleetAdminController } from './fleet/fleet-admin.controller';
import { VehiclesService } from './fleet/vehicles.service';
import { PositionsService } from './fleet/positions.service';
import { DeparturesService } from './fleet/departures.service';
import { ExitRequestsService } from './fleet/exit-requests.service';
import { ExitRequest } from './fleet/entities/exit-request.entity';
import { GeofenceService } from './geofence/geofence.service';
import { FuelService } from './fuel/fuel.service';
import { RulesService } from './rules/rules.service';
import { AlertsService } from './rules/alerts.service';
import { ImmobilizerService } from './immobilizer/immobilizer.service';
import { MaintenanceService } from './maintenance/maintenance.service';
import { MaintenanceController } from './maintenance/maintenance.controller';
import { AccountingService } from './accounting/accounting.service';
import { AccountingController } from './accounting/accounting.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    DatabaseModule,
    AuthModule,
    UsersModule,
    TypeOrmModule.forFeature([
      CommandLog,
      Vehicle,
      Position,
      Departure,
      Zone,
      FuelCalibration,
      MaintenancePlan,
      MaintenanceLog,
      Client,
      Driver,
      Trip,
      TripContainer,
      VehicleExpense,
      VehicleInvestment,
     ExitRequest,]),
    EventsModule,
    TelemetryModule,
  ],
  controllers: [
    FleetController,
    FleetAdminController,
    MaintenanceController,
    AccountingController,
    EventsController,
  ],
  providers: [
    FleetService,
    VehiclesService,
    PositionsService,
    DeparturesService,
    ExitRequestsService,
    GeofenceService,
    FuelService,
    RulesService,
    AlertsService,
    ImmobilizerService,
    MaintenanceService,
    AccountingService,

    // Ordre significatif : on identifie l'utilisateur (JwtAuthGuard)
    // avant de verifier son role (RolesGuard).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
