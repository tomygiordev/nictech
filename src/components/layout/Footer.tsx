import { Link } from 'react-router-dom';
import { MapPin, Phone, Mail, Clock, Facebook, Instagram, Youtube, Video } from 'lucide-react';

export const Footer = () => {
  return (
    <footer className="bg-secondary text-secondary-foreground">
      <div className="container-main py-12 lg:py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="space-y-4">
            <Link to="/" className="inline-block">
              <img
                src="https://tuzpcofywkhglkqplhnn.supabase.co/storage/v1/object/public/resources/Copia%20de%20path5.png"
                alt="Nictech Logo"
                className="h-12 object-contain"
              />
            </Link>
            <p className="text-secondary-foreground/80 text-sm leading-relaxed">
              Expertos en reparación y venta de tecnología. Brindando soluciones confiables.
            </p>
            <div className="flex gap-3">
              <a
                href="https://www.facebook.com/profile.php?id=61563599450690&sk=about"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Síguenos en Facebook"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary-foreground/10 hover:bg-primary transition-colors"
              >
                <Facebook className="h-4 w-4" />
              </a>
              <a
                href="https://www.instagram.com/nictech.ar/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Síguenos en Instagram"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary-foreground/10 hover:bg-primary transition-colors"
              >
                <Instagram className="h-4 w-4" />
              </a>
              <a
                href="https://www.youtube.com/@nictech.repara"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Suscribite en YouTube"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary-foreground/10 hover:bg-primary transition-colors"
              >
                <Youtube className="h-4 w-4" />
              </a>
              <a
                href="https://www.tiktok.com/@nictech.ar?_t=ZS-93n1Y2l53h3"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Síguenos en TikTok"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary-foreground/10 hover:bg-primary transition-colors"
              >
                <Video className="h-4 w-4" />
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
                  La paz 1214, Urdinarrain, Entre Ríos<br />
                  C.5 y C.19, Gilbert, Entre Ríos (sucursal)
                </span>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-primary" />
                <a
                  href="https://wa.me/5493446353769"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-secondary-foreground/80 hover:text-white transition-colors"
                >
                  +54 9 3446 35-3769
                </a>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-primary" />
                <span className="text-sm text-secondary-foreground/80">
                  nictech.urdi@gmail.com
                </span>
              </li>
              {/* 
              <li className="flex items-start gap-3">
                <Clock className="h-4 w-4 mt-0.5 text-primary" />
                <div className="text-sm text-secondary-foreground/80">
                  <p>Lun - Vie: 9:00 - 19:00</p>
                  <p>Sáb: 9:00 - 14:00</p>
                </div>
              </li>
              */}
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-secondary-foreground/10">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="text-center md:text-left">
              <p className="text-sm text-secondary-foreground/60 mb-1">
                © 2026 Nictech. Todos los derechos reservados.
              </p>
              <p className="text-sm text-secondary-foreground/50">
                Desarrollado por{' '}
                <a
                  href="https://tomygiorgi.vercel.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary transition-colors font-medium border-b border-secondary-foreground/20 hover:border-primary"
                >
                  Tomás Giorgi
                </a>
              </p>
            </div>
            <div className="flex gap-6">
              <Link
                to="/privacidad"
                className="text-sm text-secondary-foreground/60 hover:text-secondary-foreground transition-colors"
              >
                Política de Privacidad
              </Link>
              <Link
                to="/terminos"
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
