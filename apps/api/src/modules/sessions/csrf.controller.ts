import { Controller, Get, Req, Res } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

@Controller('v1/session')
export class CsrfController {
  @Get('csrf')
  bootstrap(
    @Req() request: { headers: { cookie?: string } },
    @Res({ passthrough: true }) reply: { header(name: string, value: string): void },
  ) {
    const existing = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('csrf-token='))?.slice(11);
    const csrfToken = existing && /^[a-f0-9]{64}$/.test(existing) ? existing : randomBytes(32).toString('hex');
    reply.header('cache-control', 'no-store');
    reply.header('set-cookie', `csrf-token=${csrfToken}; Path=/; HttpOnly; SameSite=Strict${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    return { csrfToken };
  }
}
