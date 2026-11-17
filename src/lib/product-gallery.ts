export interface GalleryVariant {
  image_url: string | null;
  is_active?: boolean | null;
}

export const pickPrimaryImage = (
  productImage: string | null | undefined,
  variants: readonly GalleryVariant[] | null | undefined,
): string | null => {
  const image = productImage?.trim();
  if (image) return image;
  for (const variant of variants ?? []) {
    const variantImage = variant.image_url?.trim();
    if (variant.is_active !== false && variantImage) return variantImage;
  }
  return null;
};

export const buildProductGallery = (input: {
  productImage: string | null | undefined;
  additionalImages: readonly (string | null)[] | null | undefined;
  variants: readonly GalleryVariant[];
  selectedVariantImage: string | null | undefined;
}): string[] => {
  const images = new Set<string>();
  const addImage = (image: string | null | undefined) => {
    const trimmed = image?.trim();
    if (trimmed) images.add(trimmed);
  };

  addImage(input.selectedVariantImage);
  addImage(input.productImage);
  input.additionalImages?.forEach(addImage);
  if (images.size === 0) {
    input.variants.forEach((variant) => {
      if (variant.is_active !== false) addImage(variant.image_url);
    });
  }
  return [...images];
};
