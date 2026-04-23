import { useState, lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { Navbar } from './Navbar';
import { Footer } from './Footer';
import { CartSlideOver } from './CartSlideOver';
import { WhatsAppButton } from './WhatsAppButton';

const GlobalSearch = lazy(() =>
  import('@/components/GlobalSearch').then(m => ({ default: m.GlobalSearch }))
);

interface LayoutProps {
  children: React.ReactNode;
}

const BANNER_ITEMS = [
  "Realizamos envíos a todo el país",
  "Promos y combos especiales",
  "Garantía en todos nuestros productos",
  "Atención personalizada",
];

export const Layout = ({ children }: LayoutProps) => {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar onSearchOpen={() => setSearchOpen(true)} />
      {searchOpen && (
        <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}>
          <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
        </Suspense>
      )}
      <div
        className="overflow-hidden py-2 group border-y border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),inset_0_-1px_0_rgba(120,18,26,0.45)]"
        role="marquee"
        aria-label="Información destacada"
        style={{
          background:
            'linear-gradient(90deg, #b31224 0%, #e11d48 22%, #ef4444 50%, #e11d48 78%, #991b1b 100%)',
        }}
      >
        <div className="flex w-max whitespace-nowrap animate-marquee group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused] motion-reduce:animate-none gap-0">
          {[...BANNER_ITEMS, ...BANNER_ITEMS, ...BANNER_ITEMS, ...BANNER_ITEMS].map((item, i) => (
            <span key={i} className="text-xs font-semibold tracking-[0.22em] uppercase text-white inline-flex items-center" style={{ textShadow: '0 1px 3px rgba(60,0,8,0.45)' }}>
              <span className="px-8">{item}</span>
              <span className="opacity-40">✦</span>
            </span>
          ))}
        </div>
      </div>
      <main className="flex-1">{children}</main>
      <Footer />
      <CartSlideOver />
      <WhatsAppButton />
    </div>
  );
};
