import harfbuzz from 'harfbuzzjs/hb.wasm';

// satori 0.63 bundles HarfBuzz as base64 bytes (identical to harfbuzzjs/hb.wasm) that it compiles
// and instantiates when it loads. workerd refuses to compile bytes at runtime and reads
// self.location.href first, so give it the precompiled module and a location.
export const harfbuzzBytes = 381964;

if ('WorkerGlobalScope' in globalThis) {
  if (!self.location)
    Object.defineProperty(self, 'location', { value: { href: 'https://workerd.invalid/' } });
  const instantiate = WebAssembly.instantiate.bind(WebAssembly) as (
    source: BufferSource | WebAssembly.Module,
    imports?: WebAssembly.Imports,
  ) => Promise<WebAssembly.Instance | WebAssembly.WebAssemblyInstantiatedSource>;
  Object.defineProperty(WebAssembly, 'instantiate', {
    value: async (source: BufferSource | WebAssembly.Module, imports?: WebAssembly.Imports) =>
      !(source instanceof WebAssembly.Module) && source.byteLength === harfbuzzBytes
        ? { module: harfbuzz, instance: await instantiate(harfbuzz, imports) }
        : instantiate(source, imports),
  });
}
