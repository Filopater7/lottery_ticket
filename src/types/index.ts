export const PRICE_TIERS = [1, 2, 3, 5, 10, 20, 30, 50, 100] as const;
export type PriceTier = typeof PRICE_TIERS[number];

export interface LotteryItem {
  id: string;
  number: number;
  code: string | null;
  title: string;
  image_url: string | null;
  price: PriceTier | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ItemFormData {
  number: number;
  code: string | null;
  title: string;
  image_url: string | null;
  price: PriceTier | null;
  enabled: boolean;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}
