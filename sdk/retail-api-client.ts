/**
 * Omnichannel Retail API - Typed Client SDK for Frontend Team
 * Generated from OpenAPI 3.0 Contract
 * 
 * Enforces the Golden Invariant: Never sell the same physical item twice.
 */

export interface AvailableItemRef {
  uniqueItemId: string;
  serialNumber: string;
}

export interface SearchHit {
  productId: string;
  title: string;
  description: string;
  category: string;
  price: number;
  storeId: string;
  storeName: string;
  distanceKm: number | null;
  availableCount: number;
  availableItems: AvailableItemRef[];
}

export interface SearchResponse {
  total: number;
  page: number;
  limit: number;
  hits: SearchHit[];
}

export interface SearchQueryParams {
  q?: string;
  storeId?: string;
  lat?: number;
  lon?: number;
  radiusKm?: number;
  category?: string;
  page?: number;
  limit?: number;
}

export interface ReserveItemRequest {
  uniqueItemId?: string;
  productId?: string;
  storeId: string;
  userId: string;
  ttlSeconds?: number;
}

export interface ReservationSuccessResponse {
  reservationId: string;
  uniqueItemId: string;
  serialNumber: string;
  productId: string;
  storeId: string;
  status: 'RESERVED';
  reservedAt: string;
  expiresAt: string;
}

export interface ReleaseItemRequest {
  reservationId: string;
  uniqueItemId: string;
  userId: string;
}

export interface CheckoutRequest {
  reservationId: string;
  uniqueItemId: string;
  userId: string;
  paymentToken: string;
  amount: number;
  currency?: string;
  fulfillmentType: 'IN_STORE_PICKUP' | 'SHIP_FROM_STORE';
  customerDetails?: {
    fullName: string;
    email: string;
    phone?: string;
  };
}

export interface CheckoutSuccessResponse {
  orderId: string;
  orderNumber: string;
  status: 'CONFIRMED' | 'FULFILLMENT_PENDING';
  uniqueItemId: string;
  serialNumber: string;
  storeId: string;
  totalAmount: number;
  currency: string;
  createdAt: string;
}

export interface ApiErrorPayload {
  statusCode: number;
  errorCode: string;
  message: string;
  timestamp: string;
  details?: Record<string, any>;
}

export class RetailApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string,
    public readonly payload?: ApiErrorPayload,
  ) {
    super(message);
    this.name = 'RetailApiError';
  }

  get isConflict(): boolean {
    return this.statusCode === 409;
  }

  get isReservationExpired(): boolean {
    return this.errorCode === 'RESERVATION_EXPIRED';
  }

  get isItemAlreadyReserved(): boolean {
    return this.errorCode === 'ITEM_ALREADY_RESERVED';
  }
}

export class RetailApiClient {
  private readonly baseUrl: string;

  constructor(options: { baseUrl?: string } = {}) {
    this.baseUrl = (options.baseUrl || 'http://localhost:3000/api/v1').replace(/\/$/, '');
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    };

    const res = await fetch(url, { ...options, headers });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
      throw new RetailApiError(
        res.status,
        data?.errorCode || 'API_ERROR',
        data?.message || `Request failed with status ${res.status}`,
        data,
      );
    }

    return data as T;
  }

  /**
   * Smart Search with Geo-Distance and Real-time Store Availability
   */
  async search(params: SearchQueryParams = {}): Promise<SearchResponse> {
    const query = new URLSearchParams();
    if (params.q) query.set('q', params.q);
    if (params.storeId) query.set('storeId', params.storeId);
    if (params.lat !== undefined) query.set('lat', params.lat.toString());
    if (params.lon !== undefined) query.set('lon', params.lon.toString());
    if (params.radiusKm !== undefined) query.set('radiusKm', params.radiusKm.toString());
    if (params.category) query.set('category', params.category);
    if (params.page !== undefined) query.set('page', params.page.toString());
    if (params.limit !== undefined) query.set('limit', params.limit.toString());

    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request<SearchResponse>(`/search${qs}`, { method: 'GET' });
  }

  /**
   * Pessimistically reserve an exact physical item (or dynamic allocate) with TTL.
   */
  async reserveItem(req: ReserveItemRequest): Promise<ReservationSuccessResponse> {
    return this.request<ReservationSuccessResponse>('/cart/reserve', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  /**
   * Release an active reservation when a user empties cart or removes item.
   */
  async releaseItem(req: ReleaseItemRequest): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>('/cart/release', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  /**
   * Complete checkout and commit physical unit to SOLD.
   */
  async checkout(req: CheckoutRequest): Promise<CheckoutSuccessResponse> {
    return this.request<CheckoutSuccessResponse>('/checkout', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  /**
   * Inspect live stock and serial numbers for a given store and product.
   */
  async getStoreInventory(storeId: string, productId: string) {
    return this.request<any>(`/inventory/stores/${storeId}/products/${productId}`, {
      method: 'GET',
    });
  }
}
