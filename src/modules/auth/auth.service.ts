import { Injectable, UnauthorizedException, ConflictException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { User, UserRole } from './entities/user.entity';
import { RegisterDto, LoginDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtSecret = process.env.JWT_SECRET || 'aiven-retail-production-secret-key-32chars!';

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * Hashes a password using PBKDF2 with SHA512 and salt.
   */
  private hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
  }

  /**
   * Verifies password against stored salt and hash.
   */
  private verifyPassword(password: string, storedHash: string): boolean {
    const [salt, originalHash] = storedHash.split(':');
    if (!salt || !originalHash) return false;
    const computedHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(originalHash, 'hex'));
  }

  /**
   * Signs a JWT using HMAC-SHA256.
   */
  private generateToken(payload: { sub: string; email: string; role: UserRole; storeId?: string }): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + 86400 * 7; // 7 days
    const body = Buffer.from(JSON.stringify({ ...payload, exp, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.jwtSecret)
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  /**
   * Validates and decodes a JWT token.
   */
  verifyToken(token: string): { sub: string; email: string; role: UserRole; storeId?: string } {
    try {
      const [header, body, signature] = token.split('.');
      if (!header || !body || !signature) {
        throw new UnauthorizedException('Malformed token');
      }

      const expectedSig = crypto
        .createHmac('sha256', this.jwtSecret)
        .update(`${header}.${body}`)
        .digest('base64url');

      if (signature !== expectedSig) {
        throw new UnauthorizedException('Invalid token signature');
      }

      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        throw new UnauthorizedException('Token has expired');
      }

      return payload;
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired authentication token');
    }
  }

  /**
   * Registers a new user.
   */
  async register(dto: RegisterDto) {
    const existing = await this.userRepo.findOne({ where: { email: dto.email.toLowerCase() } });
    if (existing) {
      throw new ConflictException(`User with email '${dto.email}' already exists.`);
    }

    const passwordHash = this.hashPassword(dto.password);
    const user = this.userRepo.create({
      email: dto.email.toLowerCase(),
      passwordHash,
      fullName: dto.fullName,
      role: dto.role || UserRole.CUSTOMER,
      assignedStoreId: dto.assignedStoreId,
    });

    const saved = await this.userRepo.save(user);

    const token = this.generateToken({
      sub: saved.id,
      email: saved.email,
      role: saved.role,
      storeId: saved.assignedStoreId,
    });

    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: 604800,
      user: {
        id: saved.id,
        email: saved.email,
        fullName: saved.fullName,
        role: saved.role,
        assignedStoreId: saved.assignedStoreId,
      },
    };
  }

  /**
   * Authenticates user credentials and generates session token.
   */
  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({ where: { email: dto.email.toLowerCase() } });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = this.verifyPassword(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const token = this.generateToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      storeId: user.assignedStoreId,
    });

    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: 604800,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        assignedStoreId: user.assignedStoreId,
      },
    };
  }

  async getProfile(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User profile not found');
    }
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      assignedStoreId: user.assignedStoreId,
      createdAt: user.createdAt,
    };
  }
}
