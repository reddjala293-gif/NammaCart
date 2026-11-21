import { IsOptional, IsString, IsUUID, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SearchQueryDto {
  @ApiPropertyOptional({
    description: 'Fuzzy query matching product title, description, category, or tags.',
    example: 'trail runner waterproof',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    description: 'Filter strictly by specific store mini-warehouse UUID.',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional({
    description: 'Shopper GPS latitude for geo-distance sorting and store proximity filtering.',
    example: 40.7128,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lat?: number;

  @ApiPropertyOptional({
    description: 'Shopper GPS longitude for geo-distance sorting and store proximity filtering.',
    example: -74.006,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lon?: number;

  @ApiPropertyOptional({
    description: 'Maximum radius in km for store proximity (default: 25km).',
    example: 25,
    default: 25,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  radiusKm?: number = 25;

  @ApiPropertyOptional({
    description: 'Product category filter.',
    example: 'Footwear',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    description: 'Pagination page number.',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of results per page.',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
