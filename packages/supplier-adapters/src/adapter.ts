import type {
  CancelResult,
  CancelSupplierOrder,
  CreateOrderResponse,
  CreateSupplierOrder,
  OfferPage,
  RevalidateRequest,
  RevalidatedOffer,
  SearchRequest,
  SupplierOrderRef,
  SupplierOrderSnapshot,
  SupplierOrderUpdate,
  SupplierWebhook,
} from '@travel/contracts';

export interface SupplierAdapter {
  readonly supplierId: string;
  readonly kind: SearchRequest['kind'];
  search(input: SearchRequest): Promise<OfferPage>;
  revalidate(input: RevalidateRequest): Promise<RevalidatedOffer>;
  createOrder(input: CreateSupplierOrder): Promise<CreateOrderResponse>;
  getOrder(input: SupplierOrderRef): Promise<SupplierOrderSnapshot>;
  cancel?(input: CancelSupplierOrder): Promise<CancelResult>;
  parseWebhook?(input: SupplierWebhook): Promise<SupplierOrderUpdate>;
}

export class SupplierAdapterError extends Error {
  readonly code = 'supplier_unavailable' as const;
  readonly httpStatus = 503;
  readonly retryable: boolean;
  readonly publicMessage = 'Supplier is temporarily unavailable';

  constructor(message: string, retryable = true) {
    super(message);
    this.name = 'SupplierAdapterError';
    this.retryable = retryable;
  }
}
