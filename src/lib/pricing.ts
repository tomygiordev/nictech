export const hasActiveSale = (saleExpiresAt?: string | null) => {
  if (!saleExpiresAt) {
    return true;
  }

  return new Date(saleExpiresAt) > new Date();
};

export const hasValidDiscount = ({
  price,
  originalPrice,
  saleExpiresAt,
}: {
  price: number;
  originalPrice?: number | null;
  saleExpiresAt?: string | null;
}): boolean => {
  if (originalPrice == null || originalPrice <= 0 || price <= 0 || originalPrice <= price) {
    return false;
  }
  return hasActiveSale(saleExpiresAt);
};

export const calculateOriginalUsdPrice = ({
  price,
  priceUsd,
  originalPrice,
}: {
  price: number;
  priceUsd?: number | null;
  originalPrice?: number | null;
}) => {
  if (priceUsd == null || originalPrice == null || price <= 0 || originalPrice <= price) {
    return null;
  }

  return priceUsd * (originalPrice / price);
};

export const calculateDiscountPercentage = ({
  price,
  originalPrice,
}: {
  price: number;
  originalPrice?: number | null;
}) => {
  if (originalPrice == null || originalPrice <= 0 || price <= 0 || price >= originalPrice) {
    return null;
  }

  return Math.round(((originalPrice - price) / originalPrice) * 100);
};
