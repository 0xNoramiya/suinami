/**
 * Classnames helper. Mirrors @suinami/ui's `cn` (a clsx wrapper) but stays
 * self-contained so the web shell has no hard ordering dependency on the UI
 * package's build. `clsx` is a direct dependency of @suinami/web.
 */
import { clsx, type ClassValue } from "clsx";

export function cn(...classes: ClassValue[]): string {
  return clsx(classes);
}
