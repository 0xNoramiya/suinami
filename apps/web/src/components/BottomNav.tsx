/**
 * Frosted bottom tab bar — the app's primary navigation.
 * Feed / Tide Charts / Upload / Profile, water aesthetic (backdrop blur over
 * the abyss). Every tab is a >=44px hit target for thumbs.
 */
import { cn } from "@/lib/cn";

export type Route = "feed" | "tides" | "upload" | "profile";

interface NavItem {
  route: Route;
  label: string;
  /** Inline SVG glyph (stroked, currentColor) so it tints with active state. */
  icon: React.ReactNode;
}

const ITEMS: readonly NavItem[] = [
  {
    route: "feed",
    label: "Feed",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M2 12c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" />
        <path d="M2 17c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" />
        <path d="M2 7c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" opacity={0.5} />
      </svg>
    ),
  },
  {
    route: "tides",
    label: "Tides",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 20V10" />
        <path d="M10 20V4" />
        <path d="M16 20v-7" />
        <path d="M22 20V8" />
      </svg>
    ),
  },
  {
    route: "upload",
    label: "Upload",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 19V6" />
        <path d="M6 12l6-6 6 6" />
        <path d="M5 21h14" />
      </svg>
    ),
  },
  {
    route: "profile",
    label: "Profile",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx={12} cy={8} r={4} />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    ),
  },
];

interface BottomNavProps {
  active: Route;
  onNavigate: (route: Route) => void;
}

export function BottomNav({ active, onNavigate }: BottomNavProps) {
  return (
    <nav
      aria-label="Primary"
      className="glass safe-bottom fixed inset-x-0 bottom-0 z-40"
      style={{ borderTop: "var(--hairline)" }}
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-2">
        {ITEMS.map((item) => {
          const isActive = item.route === active;
          return (
            <li key={item.route} className="relative flex-1">
              <button
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => onNavigate(item.route)}
                className={cn(
                  "flex min-h-[52px] w-full flex-col items-center justify-center gap-1.5 py-2",
                  "font-mono text-[9px] uppercase tracking-[0.18em] transition-all duration-300",
                  isActive ? "text-aqua" : "text-foam/45 hover:text-foam/75",
                )}
              >
                {/* Active crest: a glowing tide-line that surfaces above the tab. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-0 left-1/2 h-[2px] -translate-x-1/2 rounded-full bg-aqua transition-all duration-300",
                    isActive ? "w-7 opacity-100" : "w-0 opacity-0",
                  )}
                  style={isActive ? { boxShadow: "var(--glow-aqua)" } : undefined}
                />
                <span
                  className="h-6 w-6 transition-transform duration-300"
                  style={
                    isActive
                      ? {
                          filter: "drop-shadow(0 0 6px rgba(111,230,225,0.7))",
                          transform: "translateY(-1px) scale(1.08)",
                        }
                      : undefined
                  }
                >
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
