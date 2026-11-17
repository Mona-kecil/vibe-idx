declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}

interface CacheStorage {
  readonly default: Cache;
}
