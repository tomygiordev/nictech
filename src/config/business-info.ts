export interface BusinessInfo {
  legalName: string | null;
  cuit: string | null;
  dataFiscalUrl: string | null;
  contactEmail: string;
  googleReviewsUrl: string | null;
}

export const BUSINESS_INFO: BusinessInfo = {
  legalName: null,
  cuit: null,
  dataFiscalUrl: null,
  contactEmail: 'nictech.urdi@gmail.com',
  googleReviewsUrl: null,
};

export const isValidCuit = (value: string): boolean => {
  if (!/^\d{2}-\d{8}-\d$/.test(value)) return false;

  const digits = value.replace(/-/g, '').split('').map(Number);
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((total, weight, index) => total + weight * digits[index], 0);
  const remainder = 11 - (sum % 11);
  const verifier = remainder === 11 ? 0 : remainder;
  return verifier !== 10 && verifier === digits[10];
};
