/**
 * @suinami/ui — cn helper. Thin wrapper over clsx so every package has one
 * canonical way to compose conditional class strings. Kept JSX-free in its own
 * module so it can be imported by both .ts and .tsx files.
 *
 * Note: clsx@2 exposes a named `clsx` function and a `ClassValue` type, so we
 * import both by name (works under the repo's bundler module resolution).
 */
import { clsx, type ClassValue } from "clsx";

/** Re-export clsx's class-value type for consumers and our own components. */
export type { ClassValue };

/** cn — conditional className join. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
