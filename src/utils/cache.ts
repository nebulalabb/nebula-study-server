interface CacheItem {
  value: any;
  expiresAt?: number | undefined;
}

const memoryCache = new Map<string, CacheItem>();

export const cache = {
  /**
   * Set a value in cache with optional TTL (seconds)
   */
  set: async (key: string, value: any, ttlSeconds?: number): Promise<void> => {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    memoryCache.set(key, { value, expiresAt });
  },

  /**
   * Get a value from cache
   */
  get: async <T = any>(key: string): Promise<T | null> => {
    const item = memoryCache.get(key);
    if (!item) return null;

    // Check expiration
    if (item.expiresAt && item.expiresAt < Date.now()) {
      memoryCache.delete(key);
      return null;
    }

    return item.value as T;
  },

  /**
   * Delete a key from cache
   */
  del: async (key: string): Promise<void> => {
    memoryCache.delete(key);
  },

  /**
   * Close cache (noop for memory cache)
   */
  close: () => {
    memoryCache.clear();
  },
};

export default cache;
