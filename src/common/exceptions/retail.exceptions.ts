import { HttpException, HttpStatus } from '@nestjs/common';

export class ItemUnavailableException extends HttpException {
  constructor(message = 'The requested physical unit is currently reserved or unavailable.') {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        errorCode: 'ITEM_ALREADY_RESERVED',
        message,
        timestamp: new Date().toISOString(),
      },
      HttpStatus.CONFLICT,
    );
  }
}

export class ReservationExpiredException extends HttpException {
  constructor(message = 'Your inventory reservation has expired. The physical unit was returned to stock.') {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        errorCode: 'RESERVATION_EXPIRED',
        message,
        timestamp: new Date().toISOString(),
      },
      HttpStatus.CONFLICT,
    );
  }
}

export class ReservationNotFoundException extends HttpException {
  constructor(message = 'Active reservation not found for this user and item.') {
    super(
      {
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: 'RESERVATION_NOT_FOUND',
        message,
        timestamp: new Date().toISOString(),
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

export class PaymentFailedException extends HttpException {
  constructor(message = 'Payment authorization failed.') {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        errorCode: 'PAYMENT_FAILED',
        message,
        timestamp: new Date().toISOString(),
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
