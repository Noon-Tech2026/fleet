import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { FleetService } from './fleet.service';
import { ImmobilizerService } from '../immobilizer/immobilizer.service';
import { AlertsService } from '../rules/alerts.service';
import { GeofenceService } from '../geofence/geofence.service';
import { SimulatorSource } from '../telemetry/simulator.source';
import { RequireRole } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/auth.service';

class CommandDto {
  /**
   * Motif obligatoire : il finit dans le journal d'audit et c'est la
   * seule chose qui permettra plus tard d'expliquer une immobilisation.
   */
  @IsString()
  @IsNotEmpty()
  @MinLength(5, { message: 'Le motif doit faire au moins 5 caracteres' })
  @MaxLength(255)
  reason: string;
}

@Controller('api')
export class FleetController {
  constructor(
    private readonly fleet: FleetService,
    private readonly immobilizer: ImmobilizerService,
    private readonly alerts: AlertsService,
    private readonly geofence: GeofenceService,
    private readonly simulator: SimulatorSource,
  ) {}

  /* --- lecture : tout utilisateur authentifie --------------------------- */

  @Get('vehicles')
  vehicles() {
    return this.fleet.all();
  }

  @Get('vehicles/:id')
  vehicle(@Param('id') id: string) {
    return this.fleet.get(id);
  }

  @Get('zones')
  zones() {
    return this.geofence.all();
  }

  @Get('alerts')
  alertList() {
    return this.alerts.recent();
  }

  @Get('vehicles/:id/commands')
  commandHistory(@Param('id') id: string) {
    return this.immobilizer.history(id);
  }

  /* --- exploitation courante ------------------------------------------- */

  @RequireRole(Role.Operator)
  @Post('alerts/:id/acknowledge')
  acknowledge(@Param('id') id: string) {
    return this.alerts.acknowledge(id);
  }

  @RequireRole(Role.Operator)
  @Post('vehicles/:id/departure/confirm')
  confirm(@Param('id') id: string) {
    return this.fleet.confirmDeparture(id);
  }

  /* --- controle moteur : superviseur minimum --------------------------- */

  /**
   * Blocage du demarreur.
   *
   * L'API accepte toujours la demande mais decide seule du moment
   * d'execution — voir ImmobilizerService. Le champ `applied` de la reponse
   * indique si la commande est partie ou si elle attend l'arret du vehicule.
   */
  @RequireRole(Role.Supervisor)
  @Post('vehicles/:id/starter/block')
  async block(@Param('id') id: string, @Body() dto: CommandDto, @CurrentUser() user: JwtPayload) {
    const vehicle = this.fleet.get(id);
    return this.immobilizer.requestBlock(vehicle, { id: user.sub, email: user.email }, dto.reason);
  }

  @RequireRole(Role.Supervisor)
  @Post('vehicles/:id/starter/release')
  async release(@Param('id') id: string, @Body() dto: CommandDto, @CurrentUser() user: JwtPayload) {
    const vehicle = this.fleet.get(id);
    return this.immobilizer.release(vehicle, { id: user.sub, email: user.email }, dto.reason);
  }

  /* --- outil de test --------------------------------------------------- */

  /** Reserve au mode simulateur : reproduit l'appui du bouton physique. */
  @RequireRole(Role.Operator)
  @Post('simulator/vehicles/:id/press-button')
  pressButton(@Param('id') id: string) {
    this.simulator.pressButton(id);
    return { ok: true };
  }
}
