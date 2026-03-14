export function typedKeys<T extends object>(value: T): Array<Extract<keyof T, string>> {
  return Reflect.ownKeys(value).filter((key): key is Extract<keyof T, string> => {
    return typeof key === "string" && key in value;
  });
}
