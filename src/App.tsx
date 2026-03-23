import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { CartProvider } from "@/contexts/CartContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Loader2 } from "lucide-react";
import Index from "./pages/Index";
import Tienda from "./pages/Tienda";
import NotFound from "./pages/NotFound";

// Lazy-loaded routes (not needed on initial page load)
const Servicios = lazy(() => import("./pages/Servicios"));
const Seguimiento = lazy(() => import("./pages/Seguimiento"));
const Blog = lazy(() => import("./pages/Blog"));
const Contacto = lazy(() => import("./pages/Contacto"));
const Admin = lazy(() => import("./pages/Admin"));
const Login = lazy(() => import("./pages/Login"));
const Checkout = lazy(() => import("./pages/Checkout"));
const TerminosCondiciones = lazy(() => import("./pages/TerminosCondiciones"));
const PoliticasPrivacidad = lazy(() => import("./pages/PoliticasPrivacidad"));

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 1000 * 60 * 5,   // 5 minutes before data is considered stale
      gcTime: 1000 * 60 * 10,     // 10 minutes before unused cache is garbage collected
    },
  },
});

const App = () => (
  <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CartProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/tienda" element={<Tienda />} />
                <Route path="/checkout" element={<Checkout />} />
                <Route path="/servicios" element={<Servicios />} />
                <Route path="/seguimiento" element={<Seguimiento />} />
                <Route path="/blog" element={<Blog />} />
                <Route path="/contacto" element={<Contacto />} />
                <Route path="/login" element={<Login />} />
                <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
                <Route path="/terminos" element={<TerminosCondiciones />} />
                <Route path="/privacidad" element={<PoliticasPrivacidad />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
              </Suspense>
              </ErrorBoundary>
            </BrowserRouter>
          </TooltipProvider>
        </CartProvider>
      </AuthProvider>
    </QueryClientProvider>
  </HelmetProvider>
);

export default App;
