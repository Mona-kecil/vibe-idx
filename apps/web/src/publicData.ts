import { useEffect, useState } from 'react';
import { fetchActions, fetchCalendar, fetchRisk, type Resource } from './terminal/sources';

function once<T>(load: () => Promise<Resource<T>>) {
  let promise: Promise<Resource<T>> | undefined;
  return () => (promise ??= load());
}

const loaders = {
  risk: once(() => fetchRisk()),
  actions: once(() => fetchActions()),
  calendar: once(() => fetchCalendar()),
};
type Key = keyof typeof loaders;
export type Published<K extends Key> = Awaited<ReturnType<(typeof loaders)[K]>>;

export function usePublished<K extends Key>(key: K): Published<K> {
  const [resource, setResource] = useState<Resource<unknown>>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    void loaders[key]().then((next) => live && setResource(next));
    return () => {
      live = false;
    };
  }, [key]);
  return resource as Published<K>;
}
