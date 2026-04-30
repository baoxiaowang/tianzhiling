import { Controller, Get } from '@midwayjs/core';

@Controller('/system')
export class AdminSystemController {
  @Get('/health')
  async health() {
    return {
      status: 'ok',
      service: 'admin-node',
      timestamp: Date.now(),
    };
  }
}
