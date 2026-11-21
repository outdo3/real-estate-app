export function disabledDatabase<T extends object>(): T {
  return new Proxy(Object.freeze({}), {
    get() {
      throw new Error('Database access is disabled in the isolated QA deployment');
    },
  }) as T;
}
