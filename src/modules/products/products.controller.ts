import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ProductsService } from './products.service';

@ApiTags('Catalog')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'List all products in catalog' })
  async getProducts() {
    return this.productsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get product details by ID' })
  async getProduct(@Param('id') id: string) {
    return this.productsService.findById(id);
  }
}
