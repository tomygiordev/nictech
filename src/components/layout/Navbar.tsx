import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, ShoppingCart, Key, ChevronDown, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/contexts/CartContext';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { supabase } from '@/integrations/supabase/client';

const navLinks = [
  { href: '/', label: 'Inicio' },
  { href: '/servicios', label: 'Servicios' },
  { href: '/seguimiento', label: 'Seguimiento' },
  { href: '/blog', label: 'Blog' },
  { href: '/contacto', label: 'Contacto' },
];

const PHONE_BRANDS = ['Samsung', 'iPhone', 'Xiaomi', 'Motorola'];

// Categorías que tienen submenu de marcas
const isBrandCategory = (name: string) =>
  name.toLowerCase().includes('smartphone') ||
  name.toLowerCase().includes('celular') ||
  name.toLowerCase().includes('funda');

// Nombre visible en el navbar (alias)
const displayName = (name: string) => {
  if (name.toLowerCase().includes('smartphone') || name.toLowerCase().includes('celular'))
    return 'Celulares';
  return name;
};

// Categorías que se muestran como links especiales (ya están en la barra)
const SPECIAL_NAMES = ['combos', 'promos'];

interface NavbarProps {
  onSearchOpen?: () => void;
}

interface Category {
  id: string;
  name: string;
}

export const Navbar = ({ onSearchOpen }: NavbarProps) => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const location = useLocation();
  const navigate = useNavigate();
  const { totalItems, openCart } = useCart();

  useEffect(() => {
    supabase
      .from('categories' as any)
      .select('id, name')
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (data) setCategories(data as unknown as Category[]);
      });
  }, []);

  // Ordena: Smartphone primero, luego Fundas, luego el resto
  const sortedCategories = [...categories].sort((a, b) => {
    const aPhone = a.name.toLowerCase().includes('smartphone') || a.name.toLowerCase().includes('celular');
    const bPhone = b.name.toLowerCase().includes('smartphone') || b.name.toLowerCase().includes('celular');
    const aFunda = a.name.toLowerCase().includes('funda');
    const bFunda = b.name.toLowerCase().includes('funda');
    if (aPhone && !bPhone) return -1;
    if (!aPhone && bPhone) return 1;
    if (aFunda && !bFunda) return -1;
    if (!aFunda && bFunda) return 1;
    return a.name.localeCompare(b.name);
  });

  // Separa categorías especiales (Promos/Combos) que van en barra aparte
  const dropdownCategories = sortedCategories.filter(
    c => !SPECIAL_NAMES.includes(c.name.toLowerCase())
  );

  const isActive = (href: string) => location.pathname === href;
  const isTienda = location.pathname === '/tienda';

  const linkClass = (active: boolean) =>
    cn(
      'px-3 py-2 rounded-lg text-sm font-medium transition-colors',
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

            {/* Tienda Dropdown — categorías dinámicas */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(
                    'px-3 py-2 h-auto text-sm font-medium gap-1',
                    isTienda ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Tienda <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuItem asChild>
                  <Link to="/tienda" className="cursor-pointer">Todos los productos</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />

                {dropdownCategories.map((cat) =>
                  isBrandCategory(cat.name) ? (
                    <DropdownMenuSub key={cat.id}>
                      <DropdownMenuSubTrigger className="cursor-pointer">
                        {displayName(cat.name)}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onClick={() => navigate(`/tienda?nombre=${encodeURIComponent(cat.name)}`)}
                        >
                          {cat.name.toLowerCase().includes('funda') ? 'Todas' : 'Todos'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {PHONE_BRANDS.map((brand) => (
                          <DropdownMenuItem
                            key={brand}
                            className="cursor-pointer"
                            onClick={() =>
                              navigate(`/tienda?nombre=${encodeURIComponent(cat.name)}&marca=${encodeURIComponent(brand)}`)
                            }
                          >
                            {brand}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ) : (
                    <DropdownMenuItem
                      key={cat.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/tienda?nombre=${encodeURIComponent(cat.name)}`)}
                    >
                      {cat.name}
                    </DropdownMenuItem>
                  )
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Promos y Combos como links especiales */}
            <Link
              to="/tienda?nombre=Promos"
              className="px-3 py-2 rounded-lg text-sm font-medium transition-colors text-primary/80 hover:text-primary hover:bg-primary/5"
            >
              Promos
            </Link>
            <Link
              to="/tienda?nombre=Combos"
              className="px-3 py-2 rounded-lg text-sm font-medium transition-colors text-primary/80 hover:text-primary hover:bg-primary/5"
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

            <Button variant="ghost" size="icon" className="relative" onClick={openCart}>
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

                  <Link to="/tienda" onClick={() => setSheetOpen(false)} className={linkClass(isTienda)}>
                    Tienda
                  </Link>

                  <div className="pt-2 pb-1 px-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Categorías</p>
                  </div>

                  {dropdownCategories.map((cat) => (
                    <div key={cat.id}>
                      <Link
                        to={`/tienda?nombre=${encodeURIComponent(cat.name)}`}
                        onClick={() => setSheetOpen(false)}
                        className="px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors pl-6 block"
                      >
                        {displayName(cat.name)}
                      </Link>
                      {isBrandCategory(cat.name) &&
                        PHONE_BRANDS.map((brand) => (
                          <Link
                            key={`${cat.id}-${brand}`}
                            to={`/tienda?nombre=${encodeURIComponent(cat.name)}&marca=${encodeURIComponent(brand)}`}
                            onClick={() => setSheetOpen(false)}
                            className="px-3 py-2 rounded-lg text-xs font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors pl-10 block"
                          >
                            {brand}
                          </Link>
                        ))}
                    </div>
                  ))}

                  <div className="pt-2 pb-1 px-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Destacados</p>
                  </div>
                  {[{ href: '/tienda?nombre=Promos', label: 'Promos' }, { href: '/tienda?nombre=Combos', label: 'Combos' }].map((link) => (
                    <Link
                      key={link.href}
                      to={link.href}
                      onClick={() => setSheetOpen(false)}
                      className="px-3 py-2 rounded-lg text-sm font-medium text-primary/80 hover:text-primary hover:bg-primary/5 transition-colors pl-6"
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
