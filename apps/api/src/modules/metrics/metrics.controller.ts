import { Controller, Get } from '@nestjs/common';
import { metrics } from '@travel/observability';
@Controller('metrics')
export class MetricsController { @Get() get() { return metrics.snapshot(); } }
