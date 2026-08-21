import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MaintenanceService } from './maintenance.service';
import { MAINTENANCE_CATALOG } from './maintenance.catalog';
import { FleetService } from '../fleet/fleet.service';
import { RequireRole } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/auth.service';
import { MaintenanceKind, VehicleState } from '../common/types';

/* --- DTO ------------------------------------------------------------------ */

class RecordServiceDto {
  /** Date de l'intervention. Par defaut maintenant — un entretien
   *  s'enregistre parfois le lendemain. */
  @IsOptional() @IsDateString() at?: string;

  @IsOptional() @IsInt() @Min(0) @Max(5_000_000) odometer?: number;
  @IsOptional() @IsInt() @Min(0) @Max(200_000) engineHours?: number;
  @IsOptional() @IsString() @MaxLength(120) partReference?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1_000_000) cost?: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

class PlanDto {
  @IsOptional() @IsInt() @Min(100) @Max(500_000) intervalKm?: number;
  @IsOptional() @IsInt() @Min(10) @Max(50_000) intervalHours?: number;
  @IsOptional() @IsInt() @Min(1) @Max(3650) intervalDays?: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

/* --- controleur ----------------------------------------------------------- */

@Controller('api')
export class MaintenanceController {
  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly fleet: FleetService,
  ) {}

  /* --- lecture : tout utilisateur authentifie --------------------------- */

  /** Catalogue des operations suivies, pour alimenter les formulaires. */
  @Get('maintenance/catalog')
  catalog() {
    return MAINTENANCE_CATALOG;
  }

  @Get('maintenance')
  overview() {
    return this.maintenance.overview(this.fleet.all());
  }

  @Get('maintenance/logs')
  logs(@Query('vehicleId') vehicleId?: string) {
    return this.maintenance.logs(vehicleId);
  }

  @Get('vehicles/:id/maintenance')
  forVehicle(@Param('id') id: string) {
    return this.maintenance.stateFor(id, this.currentOf(id));
  }

  @Get('vehicles/:id/maintenance/logs')
  vehicleLogs(@Param('id') id: string) {
    return this.maintenance.logs(id);
  }

  /* --- exploitation : enregistrer un entretien fait --------------------- */

  /**
   * Reserve a l'exploitation et non au superviseur : consigner une
   * cartouche changee est un geste d'atelier quotidien. Definir la
   * periodicite, en revanche, engage tout le parc — voir plus bas.
   */
  @RequireRole(Role.Operator)
  @Post('vehicles/:id/maintenance/:kind/service')
  record(
    @Param('id') id: string,
    @Param('kind') kind: MaintenanceKind,
    @Body() dto: RecordServiceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const current = this.currentOf(id);

    return this.maintenance.recordService(
      id,
      kind,
      {
        at: dto.at ? new Date(dto.at) : new Date(),
        // Compteur non saisi : on retient celui de la derniere trame
        // plutot que de perdre l'axe kilometrique.
        odometer: dto.odometer ?? current?.odometer ?? null,
        engineHours: dto.engineHours ?? current?.engineHours ?? null,
        partReference: dto.partReference ?? null,
        cost: dto.cost ?? null,
        notes: dto.notes ?? null,
      },
      user.email,
      current,
    );
  }

  /* --- reglage des periodicites : superviseur --------------------------- */

  @RequireRole(Role.Supervisor)
  @Post('vehicles/:id/maintenance/:kind')
  savePlan(
    @Param('id') id: string,
    @Param('kind') kind: MaintenanceKind,
    @Body() dto: PlanDto,
  ) {
    return this.maintenance.savePlan(
      id,
      kind,
      {
        intervalKm: dto.intervalKm ?? null,
        intervalHours: dto.intervalHours ?? null,
        intervalDays: dto.intervalDays ?? null,
      },
      dto.notes ?? null,
      this.currentOf(id),
    );
  }

  /** Installe les periodicites de reference sur un camion sans suivi. */
  @RequireRole(Role.Supervisor)
  @Post('vehicles/:id/maintenance')
  applyCatalog(@Param('id') id: string) {
    return this.maintenance.applyCatalog(id);
  }

  @RequireRole(Role.Supervisor)
  @Post('maintenance/plans/:planId/deactivate')
  deactivate(@Param('planId') planId: string) {
    return this.maintenance.deactivatePlan(planId);
  }

  /* --- interne ----------------------------------------------------------- */

  /**
   * Etat courant si une trame est deja arrivee. Son absence n'est pas une
   * erreur ici : les echeances calendaires restent calculables sur un
   * camion dont le boitier n'a pas encore emis.
   */
  private currentOf(id: string): VehicleState | undefined {
    try {
      return this.fleet.get(id);
    } catch {
      return undefined;
    }
  }
}
