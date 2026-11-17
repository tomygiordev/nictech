import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Phone, Mail, Facebook, Instagram, Youtube, Video, RotateCcw, CheckCircle2, MessageCircle, FileCheck2 } from 'lucide-react';
import { BUSINESS_INFO } from '@/config/business-info';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

export const Footer = () => {
  const [regretOpen, setRegretOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [regretForm, setRegretForm] = useState({
    name: '',
    contact: '',
    orderOrProduct: '',
    notes: '',
  });

  const resetRegretModal = () => {
    setSubmitted(false);
    setRegretForm({ name: '', contact: '', orderOrProduct: '', notes: '' });
  };

  const buildRegretMessage = () => {
    const lines = [
      'Solicitud de Botón de Arrepentimiento (Ley 24.240)',
      `Nombre: ${regretForm.name.trim()}`,
      `DNI o Email: ${regretForm.contact.trim()}`,
      `Producto / Pedido: ${regretForm.orderOrProduct.trim()}`,
    ];
    if (regretForm.notes.trim()) {
      lines.push(`Comentarios: ${regretForm.notes.trim()}`);
    }
    return lines.join('\n');
  };

  const handleSendWhatsApp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!regretForm.name.trim() || !regretForm.contact.trim() || !regretForm.orderOrProduct.trim()) {
      toast.error('Por favor completá los campos obligatorios.');
      return;
    }
    const url = `https://wa.me/5493446353769?text=${encodeURIComponent(buildRegretMessage())}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setSubmitted(true);
    toast.success('Solicitud de arrepentimiento generada');
  };

  const handleSendEmail = () => {
    if (!regretForm.name.trim() || !regretForm.contact.trim() || !regretForm.orderOrProduct.trim()) {
      toast.error('Por favor completá los campos obligatorios.');
      return;
    }
    const subject = `Botón de Arrepentimiento - ${regretForm.name.trim()}`;
    const mailtoUrl = `mailto:${BUSINESS_INFO.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildRegretMessage())}`;
    window.location.href = mailtoUrl;
    setSubmitted(true);
    toast.success('Solicitud preparada en tu correo');
  };

  return (
    <footer className="bg-secondary text-secondary-foreground">
      <div className="container-main py-12 lg:py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="space-y-4">
            <Link to="/" className="inline-block">
              <img
                src="https://qatkzvlomuaoaxlfgjfa.supabase.co/storage/v1/object/public/resources/Copia%20de%20path5.png"
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
                <MapPin className="h-4 w-4 mt-0.5 text-sky-300 shrink-0" />
                <span className="text-sm text-secondary-foreground/80">
                  Héroes de Malvinas 08, Urdinarrain, Entre Ríos<br />
                  C.5 y C.19, Gilbert, Entre Ríos (sucursal)
                </span>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-sky-300 shrink-0" />
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
                <Mail className="h-4 w-4 text-sky-300 shrink-0" />
                <a
                  href={`mailto:${BUSINESS_INFO.contactEmail}`}
                  className="text-sm text-secondary-foreground/80 hover:text-white transition-colors"
                >
                  {BUSINESS_INFO.contactEmail}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-secondary-foreground/10">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="text-center md:text-left">
              <p className="text-sm text-secondary-foreground/60 mb-1">
                © 2026 Nictech. Todos los derechos reservados.
              </p>
              {(BUSINESS_INFO.legalName || BUSINESS_INFO.cuit) && (
                <p className="text-sm text-secondary-foreground/50">
                  {[BUSINESS_INFO.legalName, BUSINESS_INFO.cuit && `CUIT ${BUSINESS_INFO.cuit}`].filter(Boolean).join(' · ')}
                </p>
              )}
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
            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
              <button
                type="button"
                onClick={() => {
                  resetRegretModal();
                  setRegretOpen(true);
                }}
                className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg border border-secondary-foreground/30 bg-secondary-foreground/10 hover:bg-secondary-foreground/20 text-xs sm:text-sm font-semibold text-secondary-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <RotateCcw className="h-4 w-4 shrink-0" />
                Botón de Arrepentimiento
              </button>
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
              {BUSINESS_INFO.dataFiscalUrl && (
                <a
                  href={BUSINESS_INFO.dataFiscalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-secondary-foreground/60 hover:text-secondary-foreground transition-colors"
                >
                  <FileCheck2 className="h-4 w-4" />
                  Data Fiscal (ARCA)
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={regretOpen} onOpenChange={setRegretOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Botón de Arrepentimiento</DialogTitle>
            <DialogDescription>
              Conforme a la Ley 24.240 (Art. 34) y Res. 424/2020, podés revocar tu compra a distancia dentro de los 10 días corridos desde la recepción del producto, sin penalidad.
            </DialogDescription>
          </DialogHeader>

          {submitted ? (
            <div className="space-y-4 py-2">
              <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">Solicitud lista para procesar</p>
                  <p className="text-xs text-muted-foreground">
                    Recordá conservar el producto sin uso y con su empaque original. Nuestro equipo responderá dentro de las 24 hs hábiles para coordinar la devolución sin costo y el reintegro correspondiente.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={resetRegretModal}>
                  Nueva solicitud
                </Button>
                <Button type="button" onClick={() => setRegretOpen(false)}>
                  Cerrar
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSendWhatsApp} className="space-y-4">
              <div>
                <Label htmlFor="regret-name">Nombre completo *</Label>
                <Input
                  id="regret-name"
                  required
                  value={regretForm.name}
                  onChange={(e) => setRegretForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Tu nombre y apellido"
                />
              </div>
              <div>
                <Label htmlFor="regret-contact">DNI o Email de compra *</Label>
                <Input
                  id="regret-contact"
                  required
                  value={regretForm.contact}
                  onChange={(e) => setRegretForm(prev => ({ ...prev, contact: e.target.value }))}
                  placeholder="Ej: 35123456 o tu@email.com"
                />
              </div>
              <div>
                <Label htmlFor="regret-product">Producto o número de pedido *</Label>
                <Input
                  id="regret-product"
                  required
                  value={regretForm.orderOrProduct}
                  onChange={(e) => setRegretForm(prev => ({ ...prev, orderOrProduct: e.target.value }))}
                  placeholder="Ej: Motorola G23 / Pedido #1234"
                />
              </div>
              <div>
                <Label htmlFor="regret-notes">Comentarios (opcional)</Label>
                <Input
                  id="regret-notes"
                  value={regretForm.notes}
                  onChange={(e) => setRegretForm(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Detalle breve si lo deseás"
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <Button type="submit" className="flex-1 gap-2 min-h-[44px]">
                  <MessageCircle className="h-4 w-4" />
                  Enviar por WhatsApp
                </Button>
                <Button type="button" variant="outline" onClick={handleSendEmail} className="flex-1 gap-2 min-h-[44px]">
                  <Mail className="h-4 w-4" />
                  Enviar por Email
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </footer>
  );
};
