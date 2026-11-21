import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ScanAction {
  SOLD_IN_STORE = 'SOLD_IN_STORE',
  MARK_DAMAGED = 'MARK_DAMAGED',
  RESTOCK = 'RESTOCK',
}

export class ScanItemDto {
  @ApiProperty({
    description: 'Scanned barcode, RFID tag, or serial number from physical store scanner.',
    example: 'SN-NYC-RUN-001',
  })
  @IsString()
  serialNumber: string;

  @ApiProperty({
    description: 'Physical action performed at store.',
    enum: ScanAction,
    example: ScanAction.SOLD_IN_STORE,
  })
  @IsEnum(ScanAction)
  action: ScanAction;

  @ApiPropertyOptional({
    description: 'Store associate or register terminal ID.',
    example: 'POS_TERM_NYC_REGISTER_03',
  })
  @IsOptional()
  @IsString()
  terminalId?: string;
}
