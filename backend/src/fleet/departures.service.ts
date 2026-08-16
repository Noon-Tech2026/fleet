import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Departure } from './entities/departure.entity';

/**
 * Fiches de depart du superviseur.
 *
 * Une seule fiche ouverte par camion a la fois : ouvrir une nouvelle
 * fiche alors que la precedente n'est pas cloturee signalerait soit une
 * erreur de saisie, soit un camion parti sans qu'on ait solde le trajet
 * precedent. On refuse plutot que d'accumuler des fiches fantomes.
 */
@Injectable()
export class DeparturesService {
  private readonly log = new Logger(DeparturesService.name);

  constructor(@InjectRepository(Departure) private readonly repo: Repository<Departure>) {}

  async open(data: {
    vehicleId: string;
    driver: string;
    destination: string;
    cargo?: string;
    cargoWeight?: number;
    notes?: string;
    recordedBy: string;
  }): Promise<Departure> {
    const existing = await this.current(data.vehicleId);
    if (existing) {
      throw new NotFoundException(
        `Une fiche est deja ouverte pour ${data.vehicleId} (destination : ${existing.destination}). Cloturez-la d'abord.`,
      );
    }

    const departure = await this.repo.save(
      this.repo.create({
        vehicleId: data.vehicleId,
        driver: data.driver,
        destination: data.destination,
        cargo: data.cargo ?? null,
        cargoWeight: data.cargoWeight ?? null,
        notes: data.notes ?? null,
        recordedBy: data.recordedBy,
      }),
    );

    this.log.log(`Fiche ouverte : ${data.vehicleId} vers ${data.destination}`);
    return departure;
  }

  /** Fiche ouverte d'un camion, ou null. */
  async current(vehicleId: string): Promise<Departure | null> {
    return this.repo.findOne({
      where: { vehicleId, closedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  /** Rapproche l'appui du bouton chauffeur de la fiche ouverte. */
  async markConfirmed(vehicleId: string): Promise<Departure | null> {
    const departure = await this.current(vehicleId);
    if (!departure || departure.confirmedAt) return departure;

    departure.confirmedAt = new Date();
    return this.repo.save(departure);
  }

  /** Renseigne la sortie effective de station. */
  async markDeparted(vehicleId: string): Promise<Departure | null> {
    const departure = await this.current(vehicleId);
    if (!departure || departure.departedAt) return departure;

    departure.departedAt = new Date();
    return this.repo.save(departure);
  }

  async close(id: string, notes?: string): Promise<Departure> {
    const departure = await this.repo.findOne({ where: { id } });
    if (!departure) throw new NotFoundException('Fiche inconnue');

    departure.closedAt = new Date();
    if (notes) departure.notes = notes;
    return this.repo.save(departure);
  }

  async list(vehicleId?: string, limit = 100): Promise<Departure[]> {
    return this.repo.find({
      where: vehicleId ? { vehicleId } : {},
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async openList(): Promise<Departure[]> {
    return this.repo.find({ where: { closedAt: IsNull() }, order: { createdAt: 'DESC' } });
  }
}
