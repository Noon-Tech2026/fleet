import { Module, Global } from '@nestjs/common';
import { EventsService } from './events.service';

/**
 * Global : tous les modules publient sur le meme bus.
 * Le controleur SSE est declare dans AppModule car il depend
 * de FleetService et AlertsService.
 */
@Global()
@Module({
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
