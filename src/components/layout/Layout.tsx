import { useState, lazy, Suspense } from 'react';
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
        <Suspense fallback={null}>
          <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
        </Suspense>
      )}
      <div className="bg-primary text-primary-foreground overflow-hidden py-2 border-b border-primary/20">
        {/* w-max ensures translateX(-50%) is 50% of CONTENT width, not viewport */}
        <div className="flex w-max whitespace-nowrap animate-marquee gap-0">
          {[...BANNER_ITEMS, ...BANNER_ITEMS, ...BANNER_ITEMS, ...BANNER_ITEMS].map((item, i) => (
            <span key={i} className="text-xs font-medium inline-flex items-center">
              <span className="px-8">{item}</span>
              <span className="opacity-40">·</span>
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
