import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TELEMETRY_SOURCE } from './telemetry.source';
import { SimulatorSource } from './simulator.source';
import { TraccarSource } from './traccar.source';

@Global()
@Module({
  providers: [
    SimulatorSource,
    TraccarSource,
    {
      provide: TELEMETRY_SOURCE,
      inject: [ConfigService, SimulatorSource, TraccarSource],
      useFactory: (config: ConfigService, sim: SimulatorSource, traccar: TraccarSource) =>
        config.get<string>('TELEMETRY_SOURCE', 'simulator') === 'traccar' ? traccar : sim,
    },
  ],
  exports: [TELEMETRY_SOURCE, SimulatorSource],
})
export class TelemetryModule {}
