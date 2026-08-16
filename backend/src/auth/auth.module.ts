import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { User } from './entities/user.entity';
import { RefreshSession } from './entities/refresh-session.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User, RefreshSession]), JwtModule.register({})],
  providers: [AuthService],
  controllers: [AuthController],
  exports: [AuthService, TypeOrmModule],
})
export class AuthModule {}
