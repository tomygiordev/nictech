import { Link } from 'react-router-dom';
import { Cpu, MapPin, Phone, Mail, Clock, Facebook, Instagram, Twitter } from 'lucide-react';

export const Footer = () => {
  return (
    <footer className="bg-secondary text-secondary-foreground">
      <div className="container-main py-12 lg:py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="space-y-4">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-md">
                <Cpu className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold">NicTech</span>
            </Link>
            <p className="text-secondary-foreground/80 text-sm leading-relaxed">
              Expertos en reparación y venta de tecnología. Más de 10 años brindando soluciones confiables.
            </p>
            <div className="flex gap-3">
              <a
                href="#"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary-foreground/10 hover:bg-primary transition-colors"
              >
                <Facebook className="h-4 w-4" />
              </a>
              <a
                href="#"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary-foreground/10 hover:bg-primary transition-colors"
              >
                <Instagram className="h-4 w-4" />
              </a>
              <a
                href="#"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary-foreground/10 hover:bg-primary transition-colors"
              >
                <Twitter className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-semibold mb-4">Enlaces Rápidos</h4>
            <ul className="space-y-2">
              {[
                { href: '/tienda', label: 'Tienda' },
                { href: '/servicios', label: 'Servicios' },
                { href: '/seguimiento', label: 'Seguimiento' },
                { href: '/blog', label: 'Blog' },
                { href: '/contacto', label: 'Contacto' },
              ].map((link) => (
                <li key={link.href}>
                  <Link
                    to={link.href}
                    className="text-sm text-secondary-foreground/80 hover:text-secondary-foreground transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Services */}
          <div>
            <h4 className="font-semibold mb-4">Servicios</h4>
            <ul className="space-y-2">
              {[
                'Reparación de Smartphones',
                'Reparación de Laptops',
                'Cambio de Pantallas',
                'Recuperación de Datos',
                'Mantenimiento Preventivo',
              ].map((service) => (
                <li key={service}>
                  <span className="text-sm text-secondary-foreground/80">
                    {service}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-semibold mb-4">Contacto</h4>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <MapPin className="h-4 w-4 mt-0.5 text-primary" />
                <span className="text-sm text-secondary-foreground/80">
                  Av. Tecnología 123, Lima, Perú
                </span>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-primary" />
                <span className="text-sm text-secondary-foreground/80">
                  +51 999 888 777
                </span>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-primary" />
                <span className="text-sm text-secondary-foreground/80">
                  info@nictech.pe
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Clock className="h-4 w-4 mt-0.5 text-primary" />
                <div className="text-sm text-secondary-foreground/80">
                  <p>Lun - Vie: 9:00 - 19:00</p>
                  <p>Sáb: 9:00 - 14:00</p>
                </div>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-secondary-foreground/10">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm text-secondary-foreground/60">
              © 2024 NicTech. Todos los derechos reservados.
            </p>
            <div className="flex gap-6">
              <Link
                to="#"
                className="text-sm text-secondary-foreground/60 hover:text-secondary-foreground transition-colors"
              >
                Política de Privacidad
              </Link>
              <Link
                to="#"
                className="text-sm text-secondary-foreground/60 hover:text-secondary-foreground transition-colors"
              >
                Términos y Condiciones
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};
