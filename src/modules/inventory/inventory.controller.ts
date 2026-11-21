import { Controller, Get, Post, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { ScanItemDto } from './dto/scan-item.dto';

@ApiTags('Stores & Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('stores/:storeId/products/:productId')
  @ApiOperation({ summary: 'Check live physical inventory for a product at a store' })
  @ApiResponse({ status: 200, description: 'Real-time inventory counts and serials.' })
  async getStoreProductInventory(
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
  ) {
    return this.inventoryService.getStoreProductInventory(storeId, productId);
  }

  @Post('scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Physical in-store barcode / RFID scanner handler (POS & Shelf Audits)',
    description:
      'Instantly marks physical unit as SOLD_IN_STORE, MARK_DAMAGED, or RESTOCK. Prevents store associates from selling items actively locked in online carts.',
  })
  @ApiResponse({ status: 200, description: 'Physical status updated and Kafka event broadcast.' })
  @ApiResponse({ status: 409, description: 'Conflict: Item currently reserved by an online shopper.' })
  @ApiResponse({ status: 404, description: 'Serial number not found.' })
  async scanBarcode(@Body() dto: ScanItemDto) {
    return this.inventoryService.processStoreScan(dto);
  }
}
