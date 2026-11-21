import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, RolesGuard],
  exports: [AuthService, AuthGuard, RolesGuard, TypeOrmModule],
})
export class AuthModule {}
