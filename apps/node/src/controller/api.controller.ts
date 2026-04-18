import { Inject, Controller, Get, Param } from '@midwayjs/core';
import { AppError } from '../common/errors';
import { UserService } from '../service/user.service';

@Controller('/api/users')
export class UserController {
  @Inject()
  userService: UserService;

  @Get('/:uid')
  async getUser(@Param('uid') uid: string) {
    const parsedUid = Number(uid);

    if (!Number.isInteger(parsedUid) || parsedUid <= 0) {
      throw new AppError('INVALID_UID', 'uid must be a positive integer');
    }

    return this.userService.getUser({ uid: parsedUid });
  }
}
