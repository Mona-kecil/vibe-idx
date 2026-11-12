import { useSyncExternalStore } from 'react';

const narrow = '(max-width: 900px)';
export const useNarrow = () =>
  useSyncExternalStore(
    (change) => {
      const query = window.matchMedia(narrow);
      query.addEventListener('change', change);
      return () => query.removeEventListener('change', change);
    },
    () => window.matchMedia(narrow).matches,
    () => false,
  );
