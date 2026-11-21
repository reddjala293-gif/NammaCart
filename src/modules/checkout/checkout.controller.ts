import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CheckoutService } from './checkout.service';
import { ReserveItemDto } from './dto/reserve-item.dto';
import { ReleaseItemDto } from './dto/release-item.dto';
import { CheckoutDto } from './dto/checkout.dto';

@ApiTags('Cart & Reservation', 'Checkout & Orders')
@Controller()
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post('cart/reserve')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Pessimistically Reserve an Individual Physical Item (Golden Rule Enforcer)',
    description: 'Locks physical item using SELECT ... FOR UPDATE NOWAIT / SKIP LOCKED in Aiven Postgres.',
  })
  @ApiResponse({ status: 201, description: 'Item reserved successfully with TTL.' })
  @ApiResponse({ status: 409, description: 'Conflict: Item already locked or reserved by another shopper.' })
  async reserve(@Body() dto: ReserveItemDto) {
    return this.checkoutService.reserveItem(dto);
  }

  @Post('cart/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually release an unpurchased item reservation' })
  @ApiResponse({ status: 200, description: 'Item released back to AVAILABLE stock.' })
  @ApiResponse({ status: 404, description: 'Active reservation not found.' })
  async release(@Body() dto: ReleaseItemDto) {
    return this.checkoutService.releaseItem(dto);
  }

  @Post('checkout')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Complete checkout and commit physical unit to SOLD' })
  @ApiResponse({ status: 201, description: 'Order created, physical item marked SOLD.' })
  @ApiResponse({ status: 402, description: 'Payment failed.' })
  @ApiResponse({ status: 409, description: 'Reservation expired or invalid.' })
  async checkout(@Body() dto: CheckoutDto) {
    return this.checkoutService.checkout(dto);
  }
}
