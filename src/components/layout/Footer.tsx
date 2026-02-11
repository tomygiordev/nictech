import { Link } from 'react-router-dom';
import { MapPin, Phone, Mail, Clock, Facebook, Instagram, Youtube, Video } from 'lucide-react';

export const Footer = () => {
  return (
    <footer className="bg-secondary text-secondary-foreground">
      <div className="container-main py-12 lg:py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="space-y-4">
            <Link to="/" className="flex items-center gap-2">
              <img
                src="https://tuzpcofywkhglkqplhnn.supabase.co/storage/v1/object/public/product_images/Logotipo%20solo%20isotipo%20(solo%20icono%20sin%20texto).png"
                alt="Nictech Logo"
                className="h-10 w-10 object-contain"
              />
              <span className="text-xl font-bold">Nictech</span>
            </Link>
            <p className="text-secondary-foreground/80 text-sm leading-relaxed">
              Expertos en reparación y venta de tecnología. Brindando soluciones confiables.
            </p>
            <div className="flex gap-3">
              <a
                href="https://www.facebook.com/profile.php?id=61563599450690&sk=about"
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary-foreground/10 hover:bg-primary transition-colors"
              >
                <Facebook className="h-4 w-4" />
              </a>
              <a
                href="https://www.instagram.com/nictech.ar/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary-foreground/10 hover:bg-primary transition-colors"
              >
                <Instagram className="h-4 w-4" />
              </a>
              <a
                href="https://www.youtube.com/@nictech.repara"
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary-foreground/10 hover:bg-primary transition-colors"
              >
                <Youtube className="h-4 w-4" />
              </a>
              <a
                href="https://www.tiktok.com/@nictech.ar?_t=ZS-93n1Y2l53h3"
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary-foreground/10 hover:bg-primary transition-colors"
                title="TikTok"
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
                  Urdinarrain y Gilbert, Entre Ríos, Argentina
                </span>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-primary" />
                <a
                  href="https://api.whatsapp.com/message/2KHIZHSIAZETK1?autoload=1&app_absent=0"
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
            <p className="text-sm text-secondary-foreground/60">
              © 2026 Nictech. Todos los derechos reservados.
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
