import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import { RequireRole } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../auth/entities/user.entity';
import { CreateUserDto, UpdateUserDto } from '../auth/dto/create-user.dto';
import { JwtPayload } from '../auth/auth.service';

@RequireRole(Role.Admin)
@Controller('api/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: JwtPayload) {
    return this.users.update(id, dto, actor.sub);
  }

  @Post(':id/password')
  resetPassword(@Param('id') id: string, @Body() body: { password: string }) {
    return this.users.resetPassword(id, body.password);
  }
}
