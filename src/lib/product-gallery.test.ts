import { describe, expect, it } from 'vitest';
import { buildProductGallery, pickPrimaryImage } from './product-gallery';

describe('pickPrimaryImage', () => {
  it('prefers the trimmed product image', () => {
    expect(pickPrimaryImage(' product.jpg ', [{ image_url: 'variant.jpg' }])).toBe('product.jpg');
  });

  it('skips inactive and empty variant images', () => {
    const variants = [
      { image_url: 'inactive.jpg', is_active: false },
      { image_url: null, is_active: true },
      { image_url: ' active.jpg ', is_active: true },
    ];
    expect(pickPrimaryImage(null, variants)).toBe('active.jpg');
    expect(pickPrimaryImage('  ', variants)).toBe('active.jpg');
  });

  it('returns null when no image is available', () => {
    expect(pickPrimaryImage('  ', [{ image_url: ' ' }])).toBeNull();
    expect(pickPrimaryImage(null, null)).toBeNull();
  });
});

describe('buildProductGallery', () => {
  it('puts the selected image first and removes duplicates and blanks', () => {
    expect(buildProductGallery({
      productImage: 'product.jpg',
      additionalImages: ['selected.jpg', ' other.jpg ', ' ', null, 'product.jpg'],
      variants: [],
      selectedVariantImage: ' selected.jpg ',
    })).toEqual(['selected.jpg', 'product.jpg', 'other.jpg']);
  });

  it('falls back to unique images from active variants in order', () => {
    expect(buildProductGallery({
      productImage: null,
      additionalImages: [],
      selectedVariantImage: null,
      variants: [
        { image_url: 'inactive.jpg', is_active: false },
        { image_url: ' first.jpg ', is_active: true },
        { image_url: 'first.jpg' },
        { image_url: 'second.jpg', is_active: null },
        { image_url: ' ' },
      ],
    })).toEqual(['first.jpg', 'second.jpg']);
  });

  it('returns an empty array when all images are empty', () => {
    expect(buildProductGallery({
      productImage: ' ', additionalImages: [null, ' '], variants: [], selectedVariantImage: null,
    })).toEqual([]);
  });
});
