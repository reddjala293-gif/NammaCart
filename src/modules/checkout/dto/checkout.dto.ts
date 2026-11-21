import { IsUUID, IsString, IsNumber, IsPositive, IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FulfillmentType } from '../../../common/enums/item-status.enum';

export class CustomerDetailsDto {
  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  fullName: string;

  @ApiProperty({ example: 'jane.doe@example.com' })
  @IsString()
  email: string;

  @ApiPropertyOptional({ example: '+1-212-555-0199' })
  @IsOptional()
  @IsString()
  phone?: string;
}

export class CheckoutDto {
  @ApiProperty({
    description: 'Active reservation UUID returned during /cart/reserve.',
    example: 'a81d4fe6-03fa-4a24-9f4a-a459b1588661',
  })
  @IsUUID()
  reservationId: string;

  @ApiProperty({
    description: 'Target physical unit UUID.',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  @IsUUID()
  uniqueItemId: string;

  @ApiProperty({
    description: 'Shopper user identifier.',
    example: 'usr_buyer_49102',
  })
  @IsString()
  userId: string;

  @ApiProperty({
    description: 'Payment authorization token from payment provider.',
    example: 'tok_visa_4242_success',
  })
  @IsString()
  paymentToken: string;

  @ApiProperty({
    description: 'Total order amount to charge.',
    example: 189.99,
  })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({
    description: 'Currency code (default USD).',
    example: 'USD',
    default: 'USD',
  })
  @IsOptional()
  @IsString()
  currency?: string = 'USD';

  @ApiProperty({
    enum: FulfillmentType,
    example: FulfillmentType.IN_STORE_PICKUP,
  })
  @IsEnum(FulfillmentType)
  fulfillmentType: FulfillmentType;

  @ApiPropertyOptional({ type: CustomerDetailsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerDetailsDto)
  customerDetails?: CustomerDetailsDto;
}
