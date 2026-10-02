import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
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
  ValidateNested, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { AccountingService } from './accounting.service';
import { VehiclesService } from '../fleet/vehicles.service';
import { RequireRole } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/auth.service';
import { ContainerSize, VehicleExpenseCategory, VehicleInvestmentKind } from '../common/types';

/* --- DTO -------------------------------------------------------------- */

const INVESTMENT_KINDS: VehicleInvestmentKind[] = ['purchase', 'equipment', 'overhaul', 'other'];
const CONTAINER_SIZES: ContainerSize[] = ['20', '40'];

class UpdateExpenseDto {
  @IsOptional() @IsString() @MaxLength(32) category?: VehicleExpenseCategory;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsString() at?: string;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class UpdateInvestmentDto {
  @IsOptional() @IsIn(INVESTMENT_KINDS) kind?: VehicleInvestmentKind;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsString() at?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

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
  @IsOptional() @IsNumber() @Min(0) @Max(1_000_000) tripFee?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(10_000_000) monthlySalary?: number;
  @IsOptional() @IsString() @MaxLength(36) vehicleId?: string | null;
}

class ExpenseCategoryDto {
  @IsOptional() @IsString() @MaxLength(32) id?: string;
  @IsString() @MinLength(2) @MaxLength(80) labelFr: string;
  @IsOptional() @IsString() @MaxLength(80) labelEn?: string;
  @IsOptional() @IsString() @MaxLength(80) labelAr?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
}

class VersementDto {
  @IsNumber() @Min(1) @Max(100_000_000) amount: number;
  @IsOptional() @IsString() at?: string;
  @IsString() @MinLength(2) @MaxLength(160) label: string;
}

class CashEntryDto {
  @IsIn(['debit', 'credit']) kind: 'debit' | 'credit';
  @IsNumber() @Min(1) @Max(100_000_000) amount: number;
  @IsOptional() @IsString() at?: string;
  @IsString() @MinLength(2) @MaxLength(160) label: string;
}

class ClientEntryDto {
  @IsIn(['debit', 'credit']) kind: 'debit' | 'credit';
  @IsNumber() @Min(1) @Max(100_000_000) amount: number;
  @IsOptional() @IsString() at?: string;
  @IsString() @MinLength(2) @MaxLength(160) label: string;
}

class DriverSalaryDto {
  @IsString() @MaxLength(7) month: string;
  @IsOptional() @IsNumber() @Min(1) @Max(10_000_000) amount?: number;
}

class DriverPaymentDto {
  @IsOptional() @IsNumber() @Min(1) @Max(10_000_000) amount?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) feeIds?: string[];
  @IsOptional() @IsString() salaryId?: string;
  @IsOptional() @IsIn(['fee', 'salary', 'advance', 'other']) kind?: 'fee' | 'salary' | 'advance' | 'other';
  @IsOptional() @IsString() at?: string;
  @IsOptional() @IsString() @MaxLength(160) notes?: string;
}

class UpdateDriverDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) fullName?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(64) licenseNumber?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1_000_000) tripFee?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(10_000_000) monthlySalary?: number;
  @IsOptional() @IsString() @MaxLength(36) vehicleId?: string | null;
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
  @IsOptional() @IsBoolean() paid?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ContainerDto)
  containers: ContainerDto[];
}

class UpdateTripDto {
  @IsOptional() @IsString() driverId?: string;
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsDateString() startedAt?: string;
  @IsOptional() @IsDateString() endedAt?: string;
  @IsOptional() @IsString() @MaxLength(160) origin?: string;
  @IsOptional() @IsString() @MaxLength(160) destination?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1_000_000) amount?: number;
  @IsOptional() @IsBoolean() paid?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ContainerDto)
  containers?: ContainerDto[];
}

class ExpenseDto {
  @IsString() @MaxLength(32) category: VehicleExpenseCategory;
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


  /** Bandeau de synthese : revenu, charges, soldes, versements, investissements. */
  @Get('accounting/overview')
  overview(@Query('from') from?: string, @Query('to') to?: string) {
    return this.accounting.overview({ from, to });
  }

  @RequireRole(Role.Supervisor)
  @Get('accounting/versements')
  versements(@Query('from') from?: string, @Query('to') to?: string) {
    return this.accounting.versements({ from, to });
  }

  @RequireRole(Role.Supervisor)
  @Post('accounting/versements')
  addVersement(@Body() dto: VersementDto, @CurrentUser() user: JwtPayload) {
    return this.accounting.addVersement({ amount: dto.amount, at: dto.at ? new Date(dto.at) : new Date(), label: dto.label }, user.email);
  }

  @RequireRole(Role.Admin)
  @Delete('accounting/versements/:id')
  removeVersement(@Param('id') id: string) {
    return this.accounting.removeVersement(id);
  }

  /** Journal de caisse : entrees (clients + manuel), sorties (chauffeurs + manuel), solde. */
  @RequireRole(Role.Supervisor)
  @Get('accounting/cash')
  cashJournal(@Query('from') from?: string, @Query('to') to?: string) {
    return this.accounting.cashJournal({ from, to });
  }

  @RequireRole(Role.Supervisor)
  @Post('accounting/cash/entries')
  addCashEntry(@Body() dto: CashEntryDto, @CurrentUser() user: JwtPayload) {
    return this.accounting.addCashEntry({ kind: dto.kind, amount: dto.amount, at: dto.at ? new Date(dto.at) : new Date(), label: dto.label }, user.email);
  }

  @RequireRole(Role.Admin)
  @Delete('accounting/cash/entries/:id')
  removeCashEntry(@Param('id') id: string) {
    return this.accounting.removeCashEntry(id);
  }

  /** Catalogue des charges (actives). ?all=1 : y compris desactivees (admin). */
  @Get('accounting/expense-categories')
  expenseCategories(@Query('all') all?: string) {
    return this.accounting.expenseCategories(all === '1');
  }

  @RequireRole(Role.Admin)
  @Post('accounting/expense-categories')
  saveExpenseCategory(@Body() dto: ExpenseCategoryDto) {
    return this.accounting.saveExpenseCategory(dto);
  }

  @RequireRole(Role.Admin)
  @Delete('accounting/expense-categories/:id')
  deleteExpenseCategory(@Param('id') id: string) {
    return this.accounting.deleteExpenseCategory(id);
  }

  /** Journal d'un client : debit (voyages + ecritures), credit (paiements), solde. */
  @Get('accounting/clients/:id/ledger')
  clientLedger(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.accounting.clientLedger(id, { from, to });
  }

  @RequireRole(Role.Supervisor)
  @Post('accounting/clients/:id/entries')
  addClientEntry(@Param('id') id: string, @Body() dto: ClientEntryDto, @CurrentUser() user: JwtPayload) {
    return this.accounting.addClientEntry(id, { kind: dto.kind, amount: dto.amount, at: dto.at ? new Date(dto.at) : new Date(), label: dto.label }, user.email);
  }

  @RequireRole(Role.Admin)
  @Delete('accounting/clients/entries/:entryId')
  removeClientEntry(@Param('entryId') entryId: string) {
    return this.accounting.removeClientEntry(entryId);
  }

  /** Releve complet d'un chauffeur : primes, paiements, solde. */
  @Get('accounting/drivers/:id/ledger')
  driverLedger(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.accounting.driverLedger(id, { from, to });
  }

  @RequireRole(Role.Supervisor)
  @Post('accounting/drivers/:id/payments')
  addDriverPayment(@Param('id') id: string, @Body() dto: DriverPaymentDto, @CurrentUser() user: JwtPayload) {
    return this.accounting.addDriverPayment(id, { amount: dto.amount, feeIds: dto.feeIds, salaryId: dto.salaryId, kind: dto.kind, at: dto.at ? new Date(dto.at) : new Date(), notes: dto.notes }, user.email);
  }

  @RequireRole(Role.Supervisor)
  @Post('accounting/drivers/:id/salaries')
  declareDriverSalary(@Param('id') id: string, @Body() dto: DriverSalaryDto, @CurrentUser() user: JwtPayload) {
    return this.accounting.declareDriverSalary(id, { month: dto.month, amount: dto.amount }, user.email);
  }

  @RequireRole(Role.Admin)
  @Delete('accounting/drivers/salaries/:salaryId')
  removeDriverSalary(@Param('salaryId') salaryId: string) {
    return this.accounting.removeDriverSalary(salaryId);
  }

  @RequireRole(Role.Admin)
  @Delete('accounting/drivers/payments/:paymentId')
  removeDriverPayment(@Param('paymentId') paymentId: string) {
    return this.accounting.removeDriverPayment(paymentId);
  }

  /** Releve des primes d'un chauffeur (voyages confirmes), periode optionnelle. */
  @Get('accounting/drivers/:id/fees')
  driverFees(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.accounting.driverFees(id, { from, to });
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
  tripsForVehicle(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.accounting.trips({ vehicleId: id, from: from ? new Date(`${from}T00:00:00`) : undefined, to: to ? new Date(`${to}T23:59:59.999`) : undefined });
  }

  @Get('vehicles/:id/expenses')
  expenses(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.accounting.expensesFor(id, 200, { from, to });
  }

  @Get('vehicles/:id/investments')
  investments(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.accounting.investmentsFor(id, 200, { from, to });
  }

  @Get('vehicles/:id/accounting-summary')
  summary(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.accounting.summaryFor(id, { from, to });
  }

  /** Synthèse de toute la flotte, y compris les camions sans trame reçue. Période optionnelle. */
  @Get('accounting/summary')
  summaryAll(@Query('from') from?: string, @Query('to') to?: string) {
    return this.accounting.summaryForMany(this.vehicles.list().map((v) => v.id), { from, to });
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
        paid: dto.paid ?? false,
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
      driverId: dto.driverId,
      clientId: dto.clientId,
      startedAt: dto.startedAt !== undefined ? new Date(dto.startedAt) : undefined,
      endedAt: dto.endedAt !== undefined ? new Date(dto.endedAt) : undefined,
      origin: dto.origin,
      destination: dto.destination,
      amount: dto.amount,
      paid: dto.paid,
      notes: dto.notes,
      containers: dto.containers?.map((c) => ({
        containerNumber: c.containerNumber ?? null,
        size: c.size,
        loaded: c.loaded ?? true,
        notes: c.notes ?? null,
      })),
    });
  }

  /* --- charges et investissements : superviseur --------------------------- */

  @RequireRole(Role.Supervisor)
  @Post('vehicles/:id/expenses')
  async addExpense(@Param('id') id: string, @Body() dto: ExpenseDto, @CurrentUser() user: JwtPayload) {
    await this.accounting.assertCategory(dto.category);
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
  /* --- modification / suppression ------------------------------------------ */

  @RequireRole(Role.Supervisor)
  @Patch('accounting/expenses/:id')
  updateExpense(@Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.accounting.updateExpense(id, {
      category: dto.category,
      amount: dto.amount,
      at: dto.at !== undefined ? new Date(dto.at) : undefined,
      reference: dto.reference,
      notes: dto.notes,
    });
  }

  @RequireRole(Role.Supervisor)
  @Patch('accounting/investments/:id')
  updateInvestment(@Param('id') id: string, @Body() dto: UpdateInvestmentDto) {
    return this.accounting.updateInvestment(id, {
      kind: dto.kind,
      amount: dto.amount,
      at: dto.at !== undefined ? new Date(dto.at) : undefined,
      description: dto.description,
    });
  }

  /**
   * Suppression : admin uniquement. Une écriture comptable effacée ne laisse
   * aucune trace — c'est volontairement le geste le plus restreint.
   */
  @RequireRole(Role.Admin)
  @Delete('accounting/trips/:id')
  async deleteTrip(@Param('id') id: string) {
    await this.accounting.deleteTrip(id);
    return { ok: true };
  }

  @RequireRole(Role.Admin)
  @Delete('accounting/expenses/:id')
  async deleteExpense(@Param('id') id: string) {
    await this.accounting.deleteExpense(id);
    return { ok: true };
  }

  @RequireRole(Role.Admin)
  @Delete('accounting/investments/:id')
  async deleteInvestment(@Param('id') id: string) {
    await this.accounting.deleteInvestment(id);
    return { ok: true };
  }
}
