import { Controller, Get } from '@midwayjs/core';

@Controller('/api/system')
export class SystemController {
  @Get('/health')
  async health() {
    return {
      service: 'tianzhiling-node',
      status: 'ok',
    };
  }
}
