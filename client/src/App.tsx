import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Suspense, lazy, memo, Component, type ReactNode } from "react";
import { LoadingOverlay } from "@/components/ui/loading-overlay";

// Lazy loading ile komponentleri yükle
const VoiceChat = lazy(() => import("@/pages/voice-chat"));
const NotFound = lazy(() => import("@/pages/not-found"));

// Error Boundary — lazy component'lar crash olursa beyaz ekran yerine hata mesajı göster
interface ErrorBoundaryState { hasError: boolean; error?: Error; }
class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-[#141628] text-[#e5eaff] gap-4 p-8">
          <div className="text-4xl">⚠️</div>
          <h1 className="text-xl font-bold text-red-400">Bir şeyler yanlış gitti</h1>
          <p className="text-[#aab7e7] text-sm text-center max-w-md">{this.state.error?.message || 'Beklenmedik bir hata oluştu.'}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 rounded-xl bg-[#2ec8fa22] border border-[#2ec8fa44] text-[#2ec8fa] hover:bg-[#2ec8fa33] transition-all"
          >
            Sayfayı Yenile
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Loading komponenti
const PageLoader = memo(() => (
  <div className="min-h-screen flex items-center justify-center bg-[#141628]">
    <LoadingOverlay isVisible={true} />
  </div>
));
PageLoader.displayName = "PageLoader";

// Router'ı memoize et
const Router = memo(() => {
  return (
    <Switch>
      <Route path="/">
        <Suspense fallback={<PageLoader />}>
          <VoiceChat />
        </Suspense>
      </Route>
      <Route>
        <Suspense fallback={<PageLoader />}>
          <NotFound />
        </Suspense>
      </Route>
    </Switch>
  );
});
Router.displayName = "Router";

// Ana App komponenti
const App = memo(() => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <ErrorBoundary>
          <Toaster />
          <Router />
        </ErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  );
});
App.displayName = "App";

export default App;
