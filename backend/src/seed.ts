import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { config } from 'dotenv';
import { ENTITIES } from './database/entities';
import { User, Role } from './auth/entities/user.entity';
import { Vehicle } from './fleet/entities/vehicle.entity';
import { Zone } from './geofence/entities/zone.entity';
import { FuelCalibration } from './fuel/entities/fuel-calibration.entity';
import { AuthService } from './auth/auth.service';

config();

/**
 * Cree le schema puis les donnees de depart.
 *
 * Idempotent : relancer le script ne duplique rien et n'ecrase rien.
 * C'est ce qui permet de l'executer apres chaque ajout d'entite sans
 * reflechir a l'etat de la base.
 */
async function seed(): Promise<void> {
  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    username: process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
    database: process.env.DB_NAME ?? 'fleet',
    entities: ENTITIES,
    synchronize: true,
    charset: 'utf8mb4',
  });

  await dataSource.initialize();
  console.log('Schema synchronise.');

  await seedAdmin(dataSource);
  await seedVehicles(dataSource);
  await seedZones(dataSource);
  await seedCalibrations(dataSource);

  await dataSource.destroy();
  console.log('\nSeed termine.\n');
}

/* --- administrateur -------------------------------------------------------- */

async function seedAdmin(ds: DataSource): Promise<void> {
  const users = ds.getRepository(User);
  const email = (process.env.ADMIN_EMAIL ?? 'admin@fleet.local').toLowerCase();

  if (await users.findOne({ where: { email } })) {
    console.log(`Administrateur : ${email} existe deja.`);
    return;
  }

  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD ?? randomBytes(12).toString('base64url');

  if (password.length < 12) {
    console.error('ADMIN_PASSWORD doit faire au moins 12 caracteres.');
    process.exit(1);
  }

  await users.save(
    users.create({
      email,
      fullName: process.env.ADMIN_NAME ?? 'Administrateur',
      role: Role.Admin,
      passwordHash: await AuthService.hashPassword(password),
      active: true,
    }),
  );

  console.log('\n  Compte administrateur cree');
  console.log('  ---------------------------------------------');
  console.log(`  Email        : ${email}`);
  console.log(`  Mot de passe : ${generated ? password : 'celui defini dans ADMIN_PASSWORD'}`);
  if (generated) console.log('\n  Notez-le maintenant : il ne sera plus affiche.');
  console.log('  ---------------------------------------------');
}

/* --- flotte ---------------------------------------------------------------- */

const DEMO_VEHICLES: Partial<Vehicle>[] = [
  { id: 'C-01', plate: '4271 AB 16', driver: 'M. Belkacem', imei: '352093081234561' },
  { id: 'C-02', plate: '8834 CD 16', driver: 'M. Traore', imei: '352093081234562' },
  { id: 'C-03', plate: '1502 EF 16', driver: 'M. Diallo', imei: '352093081234563' },
  { id: 'C-04', plate: '6017 GH 16', driver: 'M. Nasri', imei: '352093081234564' },
  { id: 'C-05', plate: '9920 IJ 16', driver: 'M. Ould Amar', imei: '352093081234565' },
];

async function seedVehicles(ds: DataSource): Promise<void> {
  const repo = ds.getRepository(Vehicle);
  let created = 0;

  for (const data of DEMO_VEHICLES) {
    if (await repo.findOne({ where: { id: data.id } })) continue;
    await repo.save(repo.create(data));
    created++;
  }

  console.log(`Vehicules : ${created} crees, ${DEMO_VEHICLES.length - created} deja presents.`);
}

/* --- zones ----------------------------------------------------------------- */

const DEMO_ZONES: Partial<Zone>[] = [
  { name: 'Depot principal', kind: 'station', shape: 'circle', lat: 35.2, lon: -2.4, radius: 400 },
  { name: 'Carriere Km 42', kind: 'station', shape: 'circle', lat: 35.44, lon: -2.03, radius: 350 },
  { name: 'Perimetre urbain', kind: 'forbidden', shape: 'circle', lat: 35.29, lon: -2.25, radius: 2500 },
  {
    name: 'Secteur Nord',
    kind: 'forbidden',
    shape: 'polygon',
    points: [
      [35.52, -2.16],
      [35.55, -1.88],
      [35.42, -1.84],
      [35.4, -2.13],
    ],
  },
];

async function seedZones(ds: DataSource): Promise<void> {
  const repo = ds.getRepository(Zone);
  let created = 0;

  for (const data of DEMO_ZONES) {
    if (await repo.findOne({ where: { name: data.name } })) continue;
    await repo.save(repo.create(data));
    created++;
  }

  console.log(`Zones : ${created} creees, ${DEMO_ZONES.length - created} deja presentes.`);
}

/* --- calibration carburant ------------------------------------------------- */

/**
 * Courbes PROVISOIRES, lineaires par construction.
 *
 * Un reservoir aluminium de 700 L n'a pas une section constante sur sa
 * hauteur : la vraie courbe se releve a la pompe, reservoir vide puis
 * par paliers. Ces valeurs permettent de demarrer, pas de facturer.
 */
async function seedCalibrations(ds: DataSource): Promise<void> {
  const repo = ds.getRepository(FuelCalibration);
  let created = 0;

  const curve = (capacity: number) =>
    [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      volts: Number((0.5 + f * 4).toFixed(2)),
      liters: Math.round(capacity * f),
    }));

  const tanks: ReadonlyArray<readonly ['main' | 'aux', number]> = [
    ['main', 700],
    ['aux', 300],
  ];

  for (const vehicle of DEMO_VEHICLES) {
    for (const [tank, capacity] of tanks) {
      if (await repo.findOne({ where: { vehicleId: vehicle.id!, tank } })) continue;

      await repo.save(
        repo.create({
          vehicleId: vehicle.id!,
          tank,
          capacity,
          points: curve(capacity),
          calibratedBy: 'seed (provisoire)',
          calibratedAt: null,
        }),
      );
      created++;
    }
  }

  console.log(`Calibrations : ${created} creees (provisoires, a refaire sur le terrain).`);
}

seed().catch((err) => {
  console.error('Echec du seed :', err);
  process.exit(1);
});
