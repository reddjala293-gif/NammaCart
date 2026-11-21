import { IsUUID, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReleaseItemDto {
  @ApiProperty({
    description: 'Reservation ID issued at reservation time.',
    example: 'a81d4fe6-03fa-4a24-9f4a-a459b1588661',
  })
  @IsUUID()
  reservationId: string;

  @ApiProperty({
    description: 'Unique serialized physical unit UUID to release.',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  @IsUUID()
  uniqueItemId: string;

  @ApiProperty({
    description: 'User ID of the reservation owner.',
    example: 'usr_buyer_49102',
  })
  @IsString()
  userId: string;
}
