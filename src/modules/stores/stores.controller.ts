import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { StoresService } from './stores.service';

@ApiTags('Stores & Inventory')
@Controller('stores')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get()
  @ApiOperation({ summary: 'List all physical mini-warehouse retail stores' })
  @ApiResponse({ status: 200, description: 'Store list with geo coordinates.' })
  async getAllStores() {
    return this.storesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details for a specific physical store' })
  async getStore(@Param('id') id: string) {
    return this.storesService.findById(id);
  }
}
