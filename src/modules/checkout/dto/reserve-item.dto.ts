import { IsString, IsUUID, IsOptional, IsInt, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReserveItemDto {
  @ApiPropertyOptional({
    description: 'Exact serialized item UUID to reserve. If omitted, allocates next available item for productId at storeId.',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  @IsOptional()
  @IsUUID()
  uniqueItemId?: string;

  @ApiPropertyOptional({
    description: 'Product UUID. Required if uniqueItemId is omitted.',
    example: 'e6f8b122-6b94-4d62-95f1-39e2467d1d2b',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiProperty({
    description: 'Store mini-warehouse UUID where the item is physically located.',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @IsUUID()
  storeId: string;

  @ApiProperty({
    description: 'Shopper user identifier.',
    example: 'usr_buyer_49102',
  })
  @IsString()
  userId: string;

  @ApiPropertyOptional({
    description: 'Reservation TTL in seconds (default 600s = 10 min).',
    default: 600,
    minimum: 60,
    maximum: 1800,
  })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(1800)
  ttlSeconds?: number = 600;
}
