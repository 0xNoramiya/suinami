/**
 * App shell: a fixed top bar (wordmark + connect placeholder), a routed body,
 * and the frosted bottom nav. Routing is simple local state for the boot shell
 * (no router dependency yet); Feed is the default.
 */
import { useCallback, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FeedScreen } from "@/feed/FeedScreen";
import { TideCharts } from "@/screens/TideCharts";
import { Upload } from "@/screens/Upload";
import { Profile } from "@/screens/Profile";
import { BottomNav, type Route } from "@/components/BottomNav";
import { TopBar } from "@/components/TopBar";
import { ErrorBoundary, CrashProbe } from "@/components/ErrorBoundary";
import { useGlobalErrorHandlers } from "@/lib/globalErrors";

interface ScreenProps {
  route: Route;
  /** Creator whose profile to show (from a feed/leaderboard tap), or null = the tab's own user. */
  profileCreator: string | null;
  /** Video to jump to when route === "feed" (from a profile wave tap), or null. */
  feedVideoId: string | null;
  onOpenProfile: (creator: string) => void;
  onOpenUpload: () => void;
  onOpenVideo: (videoId: string) => void;
}

function CurrentScreen({
  route,
  profileCreator,
  feedVideoId,
  onOpenProfile,
  onOpenUpload,
  onOpenVideo,
}: ScreenProps) {
  switch (route) {
    case "feed":
      return (
        <FeedScreen
          onOpenProfile={onOpenProfile}
          onOpenUpload={onOpenUpload}
          initialVideoId={feedVideoId}
        />
      );
    case "tides":
      return <TideCharts onOpenProfile={onOpenProfile} />;
    case "upload":
      return <Upload />;
    case "profile":
      return <Profile creatorAddress={profileCreator} onOpenVideo={onOpenVideo} />;
    default:
      // Exhaustive: never reached, keeps the switch total under strict mode.
      return null;
  }
}

export function App() {
  const [route, setRoute] = useState<Route>("feed");
  // Which creator's profile to show when route === "profile". A feed/leaderboard
  // tap sets it; tapping the Profile tab clears it (→ the connected user).
  const [profileCreator, setProfileCreator] = useState<string | null>(null);
  // Which video to jump to when route === "feed" (set by a profile wave tap).
  const [feedVideoId, setFeedVideoId] = useState<string | null>(null);
  const reduce = useReducedMotion();

  // Surface unhandled async failures (rejected promises, handler errors) via the
  // Toast system — the half that React ErrorBoundaries can't catch.
  useGlobalErrorHandlers();

  const openProfile = useCallback((creator: string) => {
    setProfileCreator(creator);
    setRoute("profile");
  }, []);
  const openVideo = useCallback((videoId: string) => {
    setFeedVideoId(videoId);
    setRoute("feed");
  }, []);
  const navigate = useCallback((next: Route) => {
    if (next === "profile") setProfileCreator(null);
    // A manual Feed-tab tap clears any deep-link target (so it doesn't re-jump).
    if (next === "feed") setFeedVideoId(null);
    setRoute(next);
  }, []);

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden">
      {/* Top bar: wordmark + real wallet connect (dApp Kit, Tatum transport). */}
      <TopBar />

      {/* Routed body. Cheap opacity/translate transition between screens. */}
      <main className="h-full w-full">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={route}
            className="h-full w-full"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduce ? 0 : 0.18, ease: "easeOut" }}
          >
            {/* Per-view boundary: a screen crash shows a branded fallback here,
                while the TopBar + BottomNav (outside it) stay usable. resetKey
                clears a caught error when the view changes. */}
            <ErrorBoundary resetKey={`${route}|${profileCreator ?? ""}`}>
              {import.meta.env.DEV ? <CrashProbe /> : null}
              <CurrentScreen
                route={route}
                profileCreator={profileCreator}
                feedVideoId={feedVideoId}
                onOpenProfile={openProfile}
                onOpenUpload={() => navigate("upload")}
                onOpenVideo={openVideo}
              />
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </main>

      <BottomNav active={route} onNavigate={navigate} />
    </div>
  );
}
