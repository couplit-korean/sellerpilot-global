export type OperationProductImage = {
  id: string;
  imageUrl: string | null;
  imageVersion: string | null;
};

export type OperationProductImageCacheEntry = {
  imageUrl: string;
  imageVersion: string;
  expiresAt: number;
};

export function mergeOperationProductImages<T extends OperationProductImage>(
  products: T[],
  cache: Map<string, OperationProductImageCacheEntry>,
  now: number,
  cacheDurationMs: number,
) {
  const activeProductIds = new Set(products.map((product) => product.id));
  for (const productId of cache.keys()) {
    if (!activeProductIds.has(productId)) cache.delete(productId);
  }

  let missingVersionedImage = false;
  const mergedProducts = products.map((product) => {
    if (!product.imageVersion) {
      cache.delete(product.id);
      return product;
    }

    if (product.imageUrl) {
      cache.set(product.id, {
        imageUrl: product.imageUrl,
        imageVersion: product.imageVersion,
        expiresAt: now + cacheDurationMs,
      });
      return product;
    }

    const cached = cache.get(product.id);
    if (cached && cached.imageVersion === product.imageVersion && cached.expiresAt > now) {
      return { ...product, imageUrl: cached.imageUrl };
    }

    cache.delete(product.id);
    missingVersionedImage = true;
    return product;
  });

  return { products: mergedProducts, missingVersionedImage };
}
