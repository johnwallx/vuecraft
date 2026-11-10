import { useEffect, useState } from 'react';
import { api } from '../bridge/api';

// Images are content-addressed and immutable, so each is fetched once per id.
// shortcut: entries are never evicted (at most 5 MB each); add an LRU if maps with many large images appear.
const cache = new Map<string, Promise<string>>();

/** Data URL for an embedded image: undefined while loading, null if unavailable. */
export function useImageData(id: string | undefined): string | null | undefined {
  const [url, setUrl] = useState<string | null>();
  useEffect(() => {
    setUrl(undefined);
    if (!id) return;
    let live = true;
    let p = cache.get(id);
    if (!p) {
      p = api.imageData(id);
      cache.set(id, p);
      p.catch(() => cache.delete(id));
    }
    p.then(
      (u) => live && setUrl(u),
      () => live && setUrl(null),
    );
    return () => {
      live = false;
    };
  }, [id]);
  return url;
}
