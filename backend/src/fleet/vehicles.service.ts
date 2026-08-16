import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vehicle } from './entities/vehicle.entity';

/**
 * Repertoire de la flotte, avec cache : le repertoire est consulte a
 * chaque trame pour enrichir la position (plaque, chauffeur), et il
 * change quelques fois par an.
 */
@Injectable()
export class VehiclesService implements OnModuleInit {
  private readonly log = new Logger(VehiclesService.name);
  private cache = new Map<string, Vehicle>();

  constructor(@InjectRepository(Vehicle) private readonly repo: Repository<Vehicle>) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    const rows = await this.repo.find();
    this.cache = new Map(rows.map((v) => [v.id, v]));
    this.log.log(`${rows.length} vehicules au repertoire`);
  }

  peek(id: string): Vehicle | undefined {
    return this.cache.get(id);
  }

  list(): Vehicle[] {
    return [...this.cache.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<Vehicle> {
    const vehicle = this.cache.get(id) ?? (await this.repo.findOne({ where: { id } }));
    if (!vehicle) throw new NotFoundException(`Vehicule inconnu : ${id}`);
    return vehicle;
  }

  async create(data: Partial<Vehicle>): Promise<Vehicle> {
    if (!data.id) throw new BadRequestException('Le code du vehicule est obligatoire');
    if (this.cache.has(data.id)) {
      throw new BadRequestException(`Le code ${data.id} est deja utilise`);
    }
    if (data.imei && (await this.repo.findOne({ where: { imei: data.imei } }))) {
      throw new BadRequestException('Cet IMEI est deja associe a un autre vehicule');
    }

    const saved = await this.repo.save(this.repo.create(data));
    await this.reload();
    return saved;
  }

  async update(id: string, data: Partial<Vehicle>): Promise<Vehicle> {
    const vehicle = await this.get(id);
    Object.assign(vehicle, data, { id: vehicle.id });
    const saved = await this.repo.save(vehicle);
    await this.reload();
    return saved;
  }

  /**
   * Desactivation plutot que suppression : les positions et le journal
   * d'audit referencent ce code de vehicule.
   */
  async deactivate(id: string): Promise<Vehicle> {
    return this.update(id, { active: false });
  }
}
