import { Controller, Post, Get, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto } from './dto/register.dto';
import { AuthGuard } from './guards/auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@ApiTags('Auth & Identity')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user account (Customer or Store Associate)' })
  @ApiResponse({ status: 201, description: 'User registered successfully with bearer token.' })
  @ApiResponse({ status: 409, description: 'Email already exists.' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate user credentials and receive JWT session token' })
  @ApiResponse({ status: 200, description: 'Login successful with access token.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  @ApiResponse({ status: 200, description: 'User profile details.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getProfile(@CurrentUser('sub') userId: string) {
    return this.authService.getProfile(userId);
  }
}
