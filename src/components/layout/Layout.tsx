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
        className="overflow-hidden py-2 group"
        role="marquee"
        aria-label="Información destacada"
        style={{ background: '#dc2626' }}
      >
        <div className="flex w-max whitespace-nowrap animate-marquee group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused] motion-reduce:animate-none gap-0">
          {[...BANNER_ITEMS, ...BANNER_ITEMS, ...BANNER_ITEMS, ...BANNER_ITEMS].map((item, i) => (
            <span key={i} className="text-xs font-semibold tracking-[0.22em] uppercase text-white inline-flex items-center">
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
