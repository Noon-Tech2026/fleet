import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
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
import { AccountingService } from './accounting.service';
import { VehiclesService } from '../fleet/vehicles.service';
import { RequireRole } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/auth.service';
import { ContainerSize, VehicleExpenseCategory, VehicleInvestmentKind } from '../common/types';

/* --- DTO -------------------------------------------------------------- */

const EXPENSE_CATEGORIES: VehicleExpenseCategory[] = [
  'fuel',
  'tires',
  'insurance',
  'toll',
  'salary',
  'fine',
  'other',
];
const INVESTMENT_KINDS: VehicleInvestmentKind[] = ['purchase', 'equipment', 'overhaul', 'other'];
const CONTAINER_SIZES: ContainerSize[] = ['20', '40'];

class ClientDto {
  @IsString() @MinLength(2) @MaxLength(160) name: string;
  @IsOptional() @IsString() @MaxLength(190) contact?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class UpdateClientDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(190) contact?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class DriverDto {
  @IsString() @MinLength(2) @MaxLength(120) fullName: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(64) licenseNumber?: string;
}

class UpdateDriverDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) fullName?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(64) licenseNumber?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class ContainerDto {
  @IsOptional() @IsString() @MaxLength(20) containerNumber?: string;
  @IsIn(CONTAINER_SIZES) size: ContainerSize;
  @IsOptional() @IsBoolean() loaded?: boolean;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class CreateTripDto {
  @IsString() @MinLength(1) @MaxLength(32) vehicleId: string;
  @IsString() driverId: string;
  @IsString() clientId: string;
  @IsDateString() startedAt: string;
  @IsOptional() @IsDateString() endedAt?: string;
  @IsOptional() @IsString() @MaxLength(160) origin?: string;
  @IsOptional() @IsString() @MaxLength(160) destination?: string;
  @IsNumber() @Min(0) @Max(1_000_000) amount: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ContainerDto)
  containers: ContainerDto[];
}

class UpdateTripDto {
  @IsOptional() @IsDateString() endedAt?: string;
  @IsOptional() @IsString() @MaxLength(160) origin?: string;
  @IsOptional() @IsString() @MaxLength(160) destination?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1_000_000) amount?: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class ExpenseDto {
  @IsIn(EXPENSE_CATEGORIES) category: VehicleExpenseCategory;
  @IsNumber() @Min(0) @Max(1_000_000) amount: number;
  @IsOptional() @IsDateString() at?: string;
  @IsOptional() @IsString() @MaxLength(160) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class InvestmentDto {
  @IsIn(INVESTMENT_KINDS) kind: VehicleInvestmentKind;
  @IsNumber() @Min(0) @Max(10_000_000) amount: number;
  @IsOptional() @IsDateString() at?: string;
  @IsOptional() @IsString() @MaxLength(255) description?: string;
}

/* --- contrôleur --------------------------------------------------------- */

@Controller('api')
export class AccountingController {
  constructor(
    private readonly accounting: AccountingService,
    private readonly vehicles: VehiclesService,
  ) {}

  /* --- lecture : tout utilisateur authentifié ---------------------------- */

  @Get('accounting/clients')
  clients() {
    return this.accounting.clients();
  }

  @Get('accounting/drivers')
  drivers() {
    return this.accounting.drivers();
  }

  @Get('accounting/trips')
  trips(
    @Query('vehicleId') vehicleId?: string,
    @Query('clientId') clientId?: string,
    @Query('driverId') driverId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.accounting.trips({
      vehicleId,
      clientId,
      driverId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  @Get('vehicles/:id/trips')
  tripsForVehicle(@Param('id') id: string) {
    return this.accounting.trips({ vehicleId: id });
  }

  @Get('vehicles/:id/expenses')
  expenses(@Param('id') id: string) {
    return this.accounting.expensesFor(id);
  }

  @Get('vehicles/:id/investments')
  investments(@Param('id') id: string) {
    return this.accounting.investmentsFor(id);
  }

  @Get('vehicles/:id/accounting-summary')
  summary(@Param('id') id: string) {
    return this.accounting.summaryFor(id);
  }

  /** Synthèse de toute la flotte, y compris les camions sans trame reçue. */
  @Get('accounting/summary')
  summaryAll() {
    return this.accounting.summaryForMany(this.vehicles.list().map((v) => v.id));
  }

  /* --- référentiels : superviseur ----------------------------------------- */

  @RequireRole(Role.Supervisor)
  @Post('accounting/clients')
  createClient(@Body() dto: ClientDto) {
    return this.accounting.createClient(dto);
  }

  @RequireRole(Role.Supervisor)
  @Patch('accounting/clients/:id')
  updateClient(@Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.accounting.updateClient(id, dto);
  }

  @RequireRole(Role.Supervisor)
  @Post('accounting/drivers')
  createDriver(@Body() dto: DriverDto) {
    return this.accounting.createDriver(dto);
  }

  @RequireRole(Role.Supervisor)
  @Patch('accounting/drivers/:id')
  updateDriver(@Param('id') id: string, @Body() dto: UpdateDriverDto) {
    return this.accounting.updateDriver(id, dto);
  }

  /* --- voyages : exploitation ---------------------------------------------- */

  /**
   * Réservé à l'exploitation et non au superviseur : consigner un voyage
   * fait est un geste quotidien, comme consigner un entretien réalisé.
   */
  @RequireRole(Role.Operator)
  @Post('accounting/trips')
  createTrip(@Body() dto: CreateTripDto, @CurrentUser() user: JwtPayload) {
    return this.accounting.createTrip(
      {
        vehicleId: dto.vehicleId,
        driverId: dto.driverId,
        clientId: dto.clientId,
        startedAt: new Date(dto.startedAt),
        endedAt: dto.endedAt ? new Date(dto.endedAt) : null,
        origin: dto.origin ?? null,
        destination: dto.destination ?? null,
        amount: dto.amount,
        notes: dto.notes ?? null,
        containers: dto.containers.map((c) => ({
          containerNumber: c.containerNumber ?? null,
          size: c.size,
          loaded: c.loaded ?? true,
          notes: c.notes ?? null,
        })),
      },
      user.email,
    );
  }

  @RequireRole(Role.Operator)
  @Patch('accounting/trips/:id')
  updateTrip(@Param('id') id: string, @Body() dto: UpdateTripDto) {
    return this.accounting.updateTrip(id, {
      endedAt: dto.endedAt !== undefined ? new Date(dto.endedAt) : undefined,
      origin: dto.origin,
      destination: dto.destination,
      amount: dto.amount,
      notes: dto.notes,
    });
  }

  /* --- charges et investissements : superviseur --------------------------- */

  @RequireRole(Role.Supervisor)
  @Post('vehicles/:id/expenses')
  addExpense(@Param('id') id: string, @Body() dto: ExpenseDto, @CurrentUser() user: JwtPayload) {
    return this.accounting.addExpense(
      id,
      {
        category: dto.category,
        amount: dto.amount,
        at: dto.at ? new Date(dto.at) : new Date(),
        reference: dto.reference ?? null,
        notes: dto.notes ?? null,
      },
      user.email,
    );
  }

  @RequireRole(Role.Supervisor)
  @Post('vehicles/:id/investments')
  addInvestment(@Param('id') id: string, @Body() dto: InvestmentDto, @CurrentUser() user: JwtPayload) {
    return this.accounting.addInvestment(
      id,
      {
        kind: dto.kind,
        amount: dto.amount,
        at: dto.at ? new Date(dto.at) : new Date(),
        description: dto.description ?? null,
      },
      user.email,
    );
  }
}
