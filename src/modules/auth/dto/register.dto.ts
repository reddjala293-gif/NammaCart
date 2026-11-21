import { IsEmail, IsString, MinLength, IsOptional, IsEnum, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../entities/user.entity';

export class RegisterDto {
  @ApiProperty({ example: 'jane.shopper@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SuperSecurePassword123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'Jane Shopper' })
  @IsString()
  fullName: string;

  @ApiPropertyOptional({ enum: UserRole, default: UserRole.CUSTOMER })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole = UserRole.CUSTOMER;

  @ApiPropertyOptional({
    description: 'Mandatory for STORE_ASSOCIATE / STORE_MANAGER roles to bind to physical warehouse location.',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @IsOptional()
  @IsUUID()
  assignedStoreId?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'jane.shopper@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SuperSecurePassword123!' })
  @IsString()
  password: string;
}
