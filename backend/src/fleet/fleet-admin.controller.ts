import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VehiclesService } from './vehicles.service';
import { PositionsService } from './positions.service';
import { DeparturesService } from './departures.service';
import { GeofenceService } from '../geofence/geofence.service';
import { FuelService } from '../fuel/fuel.service';
import { RequireRole } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/auth.service';

/* --- DTO ------------------------------------------------------------------ */

class CreateVehicleDto {
  @IsString() @MinLength(2) @MaxLength(32) id: string;
  @IsString() @MinLength(2) @MaxLength(32) plate: string;
  @IsString() @MinLength(2) @MaxLength(120) driver: string;
  @IsString() @MinLength(10) @MaxLength(32) imei: string;
  @IsOptional() @IsString() @MaxLength(64) model?: string;
  @IsOptional() @IsInt() @Min(1) @Max(2000) tankMainCapacity?: number;
  @IsOptional() @IsInt() @Min(1) @Max(2000) tankAuxCapacity?: number;
  @IsOptional() @IsString() notes?: string;
}

class UpdateVehicleDto {
  @IsOptional() @IsString() @MaxLength(32) plate?: string;
  @IsOptional() @IsString() @MaxLength(120) driver?: string;
  @IsOptional() @IsString() @MaxLength(32) imei?: string;
  @IsOptional() @IsInt() @Min(1) @Max(2000) tankMainCapacity?: number;
  @IsOptional() @IsInt() @Min(1) @Max(2000) tankAuxCapacity?: number;
  @IsOptional() @IsString() notes?: string;
}

class ZoneDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsIn(['station', 'forbidden']) kind: 'station' | 'forbidden';
  @IsIn(['circle', 'polygon']) shape: 'circle' | 'polygon';

  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lon?: number;
  @IsOptional() @IsInt() @Min(20) @Max(200_000) radius?: number;

  @IsOptional() @IsArray() points?: [number, number][];
}

class CalibrationPointDto {
  @IsNumber() @Min(0) @Max(30) volts: number;
  @IsNumber() @Min(0) @Max(2000) liters: number;
}

class CalibrationDto {
  @IsIn(['main', 'aux']) tank: 'main' | 'aux';
  @IsInt() @Min(1) @Max(2000) capacity: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CalibrationPointDto)
  points: CalibrationPointDto[];
}

class OpenDepartureDto {
  @IsString() @IsNotEmpty() @MaxLength(120) driver: string;
  @IsString() @IsNotEmpty() @MaxLength(190) destination: string;
  @IsOptional() @IsString() @MaxLength(190) cargo?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) cargoWeight?: number;
  @IsOptional() @IsString() notes?: string;
}

/* --- contrôleur ----------------------------------------------------------- */

@Controller('api')
export class FleetAdminController {
  constructor(
    private readonly vehicles: VehiclesService,
    private readonly positions: PositionsService,
    private readonly departures: DeparturesService,
    private readonly geofence: GeofenceService,
    private readonly fuel: FuelService,
  ) {}

  /* --- répertoire des véhicules --------------------------------------- */

  @Get('fleet/vehicles')
  listVehicles() {
    return this.vehicles.list();
  }

  @RequireRole(Role.Admin)
  @Post('fleet/vehicles')
  createVehicle(@Body() dto: CreateVehicleDto) {
    return this.vehicles.create(dto);
  }

  @RequireRole(Role.Admin)
  @Patch('fleet/vehicles/:id')
  updateVehicle(@Param('id') id: string, @Body() dto: UpdateVehicleDto) {
    return this.vehicles.update(id, dto);
  }

  @RequireRole(Role.Admin)
  @Post('fleet/vehicles/:id/deactivate')
  deactivateVehicle(@Param('id') id: string) {
    return this.vehicles.deactivate(id);
  }

  /* --- historique des positions ---------------------------------------- */

  /**
   * Trajet entre deux dates. Par défaut, les dernières 24 heures.
   * La borne haute est plafonnée à 5000 points : au-delà, le navigateur
   * ne trace plus, il rame.
   */
  @Get('vehicles/:id/history')
  history(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - 24 * 3600 * 1000);
    return this.positions.history(id, start, end);
  }

  @Get('vehicles/:id/positions/count')
  async positionCount(@Param('id') id: string) {
    return { vehicleId: id, count: await this.positions.countFor(id) };
  }

  /* --- zones ------------------------------------------------------------ */

  @RequireRole(Role.Admin)
  @Get('zones/all')
  listAllZones() {
    return this.geofence.listAll();
  }

  @RequireRole(Role.Supervisor)
  @Post('zones')
  createZone(@Body() dto: ZoneDto) {
    return this.geofence.create(dto);
  }

  @RequireRole(Role.Supervisor)
  @Patch('zones/:id')
  updateZone(@Param('id') id: string, @Body() dto: ZoneDto) {
    return this.geofence.update(id, dto);
  }

  @RequireRole(Role.Supervisor)
  @Post('zones/:id/deactivate')
  deactivateZone(@Param('id') id: string) {
    return this.geofence.deactivate(id);
  }

  /* --- calibration carburant ------------------------------------------- */

  @Get('vehicles/:id/calibration')
  calibration(@Param('id') id: string) {
    return this.fuel.list(id);
  }

  /**
   * Enregistre une courbe relevée physiquement.
   * Réservé au superviseur : une courbe fausse fausse la consommation
   * de tout le parc et peut déclencher de fausses alertes de siphonnage.
   */
  @RequireRole(Role.Supervisor)
  @Post('vehicles/:id/calibration')
  saveCalibration(
    @Param('id') id: string,
    @Body() dto: CalibrationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.fuel.save(id, dto.tank, dto.capacity, dto.points, user.email);
  }

  /* --- fiches de départ -------------------------------------------------- */

  @Get('departures')
  listDepartures(@Query('vehicleId') vehicleId?: string) {
    return this.departures.list(vehicleId);
  }

  @Get('departures/open')
  openDepartures() {
    return this.departures.openList();
  }

  @Get('vehicles/:id/departure')
  currentDeparture(@Param('id') id: string) {
    return this.departures.current(id);
  }

  @RequireRole(Role.Operator)
  @Post('vehicles/:id/departure')
  openDeparture(
    @Param('id') id: string,
    @Body() dto: OpenDepartureDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.departures.open({ vehicleId: id, ...dto, recordedBy: user.email });
  }

  @RequireRole(Role.Operator)
  @Post('departures/:id/close')
  closeDeparture(@Param('id') id: string, @Body() body: { notes?: string }) {
    return this.departures.close(id, body?.notes);
  }
}
