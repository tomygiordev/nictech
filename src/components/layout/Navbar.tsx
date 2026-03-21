import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, ShoppingCart, Key, ChevronDown, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/contexts/CartContext';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

const navLinks = [
  { href: '/', label: 'Inicio' },
  { href: '/servicios', label: 'Servicios' },
  { href: '/seguimiento', label: 'Seguimiento' },
  { href: '/blog', label: 'Blog' },
  { href: '/contacto', label: 'Contacto' },
];

const categories = [
  { label: 'Celulares', nombre: 'Celulares' },
  { label: 'Fundas', nombre: 'Fundas' },
  { label: 'Vidrios Templados', nombre: 'Vidrios Templados' },
  { label: 'Auriculares', nombre: 'Auriculares' },
  { label: 'Cargadores', nombre: 'Cargadores' },
  { label: 'Accesorios', nombre: 'Accesorios' },
];

const specialLinks = [
  { href: '/tienda?nombre=Promos', label: 'Promos' },
  { href: '/tienda?nombre=Combos', label: 'Combos' },
  { href: '/tienda?nombre=Ofertas', label: 'Ofertas' },
];

interface NavbarProps {
  onSearchOpen?: () => void;
}

export const Navbar = ({ onSearchOpen }: NavbarProps) => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { totalItems, openCart } = useCart();

  const isActive = (href: string) => location.pathname === href;
  const isTienda = location.pathname === '/tienda';

  const linkClass = (active: boolean) =>
    cn(
      "px-3 py-2 rounded-lg text-sm font-medium transition-colors",
      active
        ? "bg-primary/10 text-primary"
        : "text-muted-foreground hover:text-foreground hover:bg-muted"
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
              className="h-10 w-auto object-contain transition-transform group-hover:scale-100"
            />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link key={link.href} to={link.href} className={linkClass(isActive(link.href))}>
                {link.label}
              </Link>
            ))}

            {/* Categories Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(
                    "px-3 py-2 h-auto text-sm font-medium gap-1",
                    isTienda ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Tienda <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem asChild>
                  <Link to="/tienda" className="cursor-pointer">Todos los productos</Link>
                </DropdownMenuItem>
                {categories.map((cat) => (
                  <DropdownMenuItem
                    key={cat.nombre}
                    className="cursor-pointer"
                    onClick={() => navigate(`/tienda?nombre=${encodeURIComponent(cat.nombre)}`)}
                  >
                    {cat.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Special Links */}
            {specialLinks.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                className={cn(
                  "px-3 py-2 rounded-lg text-sm font-medium transition-colors text-primary/80 hover:text-primary hover:bg-primary/5"
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right side icons */}
          <div className="flex items-center gap-1">
            {/* Admin Shortcut (Desktop) */}
            <Link to="/login" className="hidden md:block">
              <Button variant="ghost" size="icon" className="opacity-30 hover:opacity-100 transition-opacity duration-300">
                <Key className="h-5 w-5" />
                <span className="sr-only">Admin</span>
              </Button>
            </Link>

            {/* Search */}
            {onSearchOpen && (
              <Button variant="ghost" size="icon" onClick={onSearchOpen} className="hidden md:flex">
                <Search className="h-5 w-5" />
                <span className="sr-only">Buscar</span>
              </Button>
            )}

            {/* Cart */}
            <Button variant="ghost" size="icon" className="relative" onClick={openCart}>
              <ShoppingCart className="h-5 w-5" />
              {totalItems > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {totalItems}
                </span>
              )}
            </Button>

            {/* Mobile Menu (Sheet) */}
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Menú</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[280px] pt-10">
                <nav className="flex flex-col gap-1">
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

                  <Link
                    to="/tienda"
                    onClick={() => setSheetOpen(false)}
                    className={linkClass(isTienda)}
                  >
                    Tienda
                  </Link>

                  {/* Categories in mobile */}
                  <div className="pt-2 pb-1 px-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Categorías</p>
                  </div>
                  {categories.map((cat) => (
                    <Link
                      key={cat.nombre}
                      to={`/tienda?nombre=${encodeURIComponent(cat.nombre)}`}
                      onClick={() => setSheetOpen(false)}
                      className="px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors pl-6"
                    >
                      {cat.label}
                    </Link>
                  ))}

                  {/* Special links in mobile */}
                  <div className="pt-2 pb-1 px-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Destacados</p>
                  </div>
                  {specialLinks.map((link) => (
                    <Link
                      key={link.href}
                      to={link.href}
                      onClick={() => setSheetOpen(false)}
                      className="px-3 py-2 rounded-lg text-sm font-medium text-primary/80 hover:text-primary hover:bg-primary/5 transition-colors pl-6"
                    >
                      {link.label}
                    </Link>
                  ))}

                  {/* Admin link */}
                  <Link
                    to="/login"
                    onClick={() => setSheetOpen(false)}
                    className="px-4 py-3 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-2 mt-2 border-t border-border/50"
                  >
                    <Key className="h-4 w-4" />
                    Admin Panel
                  </Link>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </nav>
  );
};
