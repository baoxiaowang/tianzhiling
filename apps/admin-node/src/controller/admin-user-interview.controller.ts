import {
  Body,
  Controller,
  Del,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@midwayjs/core';
import {
  CreateUserInterviewDTO,
  ExtractInterviewDocxDTO,
  ListUserInterviewsQueryDTO,
  UpdateUserInterviewDTO,
} from '../dto/admin-user-interview.dto';
import {
  AdminUserInterviewService,
  USER_INTERVIEW_OUTLINE,
  USER_INTERVIEW_SECTIONS,
} from '../service/admin-user-interview.service';

@Controller('/user-interviews')
export class AdminUserInterviewController {
  @Inject()
  adminUserInterviewService: AdminUserInterviewService;

  @Get('/outline')
  async outline() {
    return {
      outline: USER_INTERVIEW_OUTLINE,
      sections: USER_INTERVIEW_SECTIONS,
    };
  }

  @Get('/')
  async list(@Query() query: ListUserInterviewsQueryDTO) {
    return this.adminUserInterviewService.listByUser(query.userId);
  }

  @Post('/')
  async create(@Body() body: CreateUserInterviewDTO) {
    return this.adminUserInterviewService.create(body);
  }

  @Post('/extract-docx')
  async extractDocx(@Body() body: ExtractInterviewDocxDTO) {
    return this.adminUserInterviewService.extractDocx(body);
  }

  @Put('/:id')
  async update(@Param('id') id: string, @Body() body: UpdateUserInterviewDTO) {
    return this.adminUserInterviewService.update(id, body);
  }

  @Post('/:id/structure')
  async structure(@Param('id') id: string) {
    return this.adminUserInterviewService.structure(id);
  }

  @Del('/:id')
  async remove(@Param('id') id: string) {
    return this.adminUserInterviewService.remove(id);
  }
}
