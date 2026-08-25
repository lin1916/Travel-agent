import { Controller, Get, Header } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  @Header('Content-Type', 'application/json')
  health() {
    return { status: 'ok', service: 'api' };
  }
}
