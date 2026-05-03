import { Configuration, App } from '@midwayjs/core';
import * as koa from '@midwayjs/koa';
import * as validate from '@midwayjs/validate';
import * as info from '@midwayjs/info';
import * as jwt from '@midwayjs/jwt';
import * as orm from '@midwayjs/typeorm';
import * as busboy from '@midwayjs/busboy';
import * as bullmq from '@midwayjs/bullmq';
import { join } from 'path';
import { DefaultErrorFilter } from './filter/default.filter';
import { NotFoundFilter } from './filter/notfound.filter';
import { AdminAuthMiddleware } from './middleware/admin-auth.middleware';
import { FormatMiddleware } from './middleware/format.middleware';

@Configuration({
  imports: [
    koa,
    validate,
    jwt,
    orm,
    busboy,
    bullmq,
    {
      component: info,
      enabledEnvironment: ['local'],
    },
  ],
  importConfigs: [join(__dirname, './config')],
})
export class MainConfiguration {
  @App('koa')
  app: koa.Application;

  async onReady() {
    this.app.useMiddleware([AdminAuthMiddleware]);
    this.app.useMiddleware([FormatMiddleware]);
    this.app.useFilter([NotFoundFilter, DefaultErrorFilter]);
  }
}
