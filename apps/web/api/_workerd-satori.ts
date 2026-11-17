import harfbuzz from 'harfbuzzjs/hb.wasm';

// satori 0.63 bundles HarfBuzz as base64 bytes (identical to harfbuzzjs/hb.wasm) that it compiles
// and instantiates when it loads. workerd refuses to compile bytes at runtime and reads
// self.location.href first, so give it the precompiled module and a location. Any other bytes
// would be compiled by workerd, which kills the first request as hung and poisons the isolate,
// so they are rejected at once with a reported error.
export const harfbuzzBytes = 381964;

if ('WorkerGlobalScope' in globalThis) {
  if (!self.location)
    Object.defineProperty(self, 'location', { value: { href: 'https://workerd.invalid/' } });
  const instantiate = WebAssembly.instantiate.bind(WebAssembly) as (
    source: BufferSource | WebAssembly.Module,
    imports?: WebAssembly.Imports,
  ) => Promise<WebAssembly.Instance | WebAssembly.WebAssemblyInstantiatedSource>;
  Object.defineProperty(WebAssembly, 'instantiate', {
    value: async (source: BufferSource | WebAssembly.Module, imports?: WebAssembly.Imports) => {
      if (source instanceof WebAssembly.Module) return instantiate(source, imports);
      if (source.byteLength === harfbuzzBytes)
        return { module: harfbuzz, instance: await instantiate(harfbuzz, imports) };
      throw new Error(
        `satori asked workerd to compile ${source.byteLength} bytes of WebAssembly, but the Worker has only the ${harfbuzzBytes} byte HarfBuzz precompiled. Update harfbuzzBytes to satori's.`,
      );
    },
  });
}
