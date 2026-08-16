import { User } from '../auth/entities/user.entity';
import { RefreshSession } from '../auth/entities/refresh-session.entity';
import { CommandLog } from '../auth/entities/command-log.entity';
import { Vehicle } from '../fleet/entities/vehicle.entity';
import { Position } from '../fleet/entities/position.entity';
import { Departure } from '../fleet/entities/departure.entity';
import { Zone } from '../geofence/entities/zone.entity';
import { FuelCalibration } from '../fuel/entities/fuel-calibration.entity';

/**
 * Liste unique des entites, partagee par DatabaseModule et le script
 * de seed. Deux listes divergentes produiraient un seed qui cree des
 * tables que l'application ne connait pas — ou l'inverse.
 */
export const ENTITIES = [
  User,
  RefreshSession,
  CommandLog,
  Vehicle,
  Position,
  Departure,
  Zone,
  FuelCalibration,
];
