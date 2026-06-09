import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, ShoppingCart, Key, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/contexts/CartContext';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

const navLinks = [
  { href: '/tienda', label: 'Tienda' },
  { href: '/servicios', label: 'Servicios' },
  { href: '/seguimiento', label: 'Seguimiento' },
  { href: '/blog', label: 'Blog' },
  { href: '/contacto', label: 'Contacto' },
];

interface NavbarProps {
  onSearchOpen?: () => void;
}

export const Navbar = ({ onSearchOpen }: NavbarProps) => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const location = useLocation();
  const { totalItems, openCart } = useCart();

  const isActive = (href: string) => {
    if (href === '/tienda') {
      return location.pathname === '/' || location.pathname === '/tienda';
    }
    return location.pathname === href;
  };

  const linkClass = (active: boolean) =>
    cn(
      'px-3 py-2 rounded-lg text-sm font-medium transition-all duration-100 ease-out-default active:scale-[0.97] select-none',
      active
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
    );

  return (
    <nav className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border shadow-sm">
      <div className="container-main">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 group">
            <img
              src="https://tuzpcofywkhglkqplhnn.supabase.co/storage/v1/object/public/product_images/Logotipo_color.png"
              alt="Nictech Logo"
              className="h-10 w-auto object-contain"
            />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link key={link.href} to={link.href} className={linkClass(isActive(link.href))}>
                {link.label}
              </Link>
            ))}

            {/* Promos y Combos como links especiales */}
            <Link
              to="/promos"
              className="px-3 py-2 rounded-lg text-sm font-medium transition-all duration-100 ease-out-default active:scale-[0.97] text-primary/80 hover:text-primary hover:bg-primary/5 select-none"
            >
              Promos
            </Link>
            <Link
              to="/combos"
              className="px-3 py-2 rounded-lg text-sm font-medium transition-all duration-100 ease-out-default active:scale-[0.97] text-primary/80 hover:text-primary hover:bg-primary/5 select-none"
            >
              Combos
            </Link>
          </div>

          {/* Right side icons */}
          <div className="flex items-center gap-1">
            <Link to="/login" className="hidden md:block">
              <Button variant="ghost" size="icon" className="opacity-30 hover:opacity-100 transition-opacity duration-300">
                <Key className="h-5 w-5" />
                <span className="sr-only">Admin</span>
              </Button>
            </Link>

            {onSearchOpen && (
              <Button variant="ghost" size="icon" onClick={onSearchOpen} className="hidden md:flex">
                <Search className="h-5 w-5" />
                <span className="sr-only">Buscar</span>
              </Button>
            )}

            <Button variant="ghost" size="icon" className="relative transition-all duration-100 ease-out-default active:scale-[0.93] select-none" onClick={openCart}>
              <ShoppingCart className="h-5 w-5" />
              {totalItems > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {totalItems}
                </span>
              )}
            </Button>

            {/* Mobile Menu */}
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Menú</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[280px] p-0 flex flex-col">
                {/* Área scrollable */}
                <nav className="flex-1 overflow-y-auto px-3 pt-10 pb-4 flex flex-col gap-1" style={{ WebkitOverflowScrolling: 'touch' }}>
                  {navLinks.map((link) => (
                    <Link
                      key={link.href}
                      to={link.href}
                      onClick={() => setSheetOpen(false)}
                      className={linkClass(isActive(link.href))}
                    >
                      {link.label}
                    </Link>
                  ))}

                  <div className="pt-2 pb-1 px-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Destacados</p>
                  </div>
                  {[{ href: '/promos', label: 'Promos' }, { href: '/combos', label: 'Combos' }].map((link) => (
                    <Link
                      key={link.href}
                      to={link.href}
                      onClick={() => setSheetOpen(false)}
                      className="px-3 py-2 rounded-lg text-sm font-medium text-primary/80 hover:text-primary hover:bg-primary/5 transition-all duration-100 ease-out-default active:scale-[0.97] pl-6 select-none"
                    >
                      {link.label}
                    </Link>
                  ))}
                </nav>

                {/* Admin — siempre visible al fondo */}
                <div className="border-t border-border/50 px-3 py-3 shrink-0">
                  <Link
                    to="/login"
                    onClick={() => setSheetOpen(false)}
                    className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors w-full"
                  >
                    <Key className="h-4 w-4" />
                    Panel de Administración
                  </Link>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </nav>
  );
};
