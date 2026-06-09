import { Helmet } from 'react-helmet-async';
import {
  Smartphone, Sparkles, Laptop, Monitor, ShieldCheck,
  Wrench, Shield, Zap, Award, MapPin, Phone, Mail, MessageCircle, Clock
} from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { HeroBannerCarousel } from '@/components/home/HeroBannerCarousel';

interface ServiceItem {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
}

const servicesList: ServiceItem[] = [
  {
    id: 'rep-cel-cons',
    title: 'Reparación de Celulares y Consolas',
    description: 'Cambio de pantallas, baterías, pines de carga y microelectrónica avanzada para consolas de todas las marcas.',
    icon: Smartphone,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10'
  },
  {
    id: 'manteni',
    title: 'Mantenimiento Preventivo',
    description: 'Limpieza física interna, cambio de pasta térmica de alta calidad y optimización de software de tus equipos.',
    icon: Sparkles,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10'
  },
  {
    id: 'rep-comp',
    title: 'Reparación de Computadoras',
    description: 'Diagnóstico rápido y reparación de hardware y software para computadoras de escritorio y laptops.',
    icon: Laptop,
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10'
  },
  {
    id: 'armado',
    title: 'Armado de PCs a Medida',
    description: 'Diseño y ensamblado de equipos personalizados según tu uso: estaciones de trabajo, oficina o setup gaming.',
    icon: Monitor,
    color: 'text-indigo-500',
    bgColor: 'bg-indigo-500/10'
  },
  {
    id: 'sist-seg',
    title: 'Sistemas de Seguridad',
    description: 'Instalación, configuración y mantenimiento de cámaras de seguridad y videovigilancia para casas o comercios.',
    icon: ShieldCheck,
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10'
  }
];

const getWhatsAppUrl = (topic: string) => {
  const phoneNumber = '5493446353769';
  const message = encodeURIComponent(`Hola! Me interesa obtener más información sobre: *${topic}*`);
  return `https://wa.me/${phoneNumber}?text=${message}`;
};

export const Servicios = () => {
  const ServiceIcon0 = servicesList[0].icon;
  const ServiceIcon1 = servicesList[1].icon;
  const ServiceIcon2 = servicesList[2].icon;
  const ServiceIcon3 = servicesList[3].icon;
  const ServiceIcon4 = servicesList[4].icon;

  return (
    <>
      <Helmet>
        <title>Servicios de Reparación - Nictech | Entre Ríos</title>
        <meta name="description" content="Servicios profesionales de reparación de smartphones, laptops, tablets, mantenimiento e instalación de sistemas de seguridad en Urdinarrain y Gilbert." />
      </Helmet>
      <Layout>
        {/* Banner Carousel (Restored to original location style) */}
        <div className="max-w-4xl mx-auto pt-6 px-4 sm:px-6">
          <HeroBannerCarousel />
        </div>

        {/* Header */}
        <section className="bg-muted/30 py-12 lg:py-16 mt-6">
          <div className="container-main">
            <div className="text-center max-w-2xl mx-auto">
              <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
                Nuestros Servicios
              </span>
              <h1 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
                ¿Qué podemos hacer por vos?
              </h1>
              <p className="text-muted-foreground text-lg">
                Ofrecemos soluciones técnicas certificadas con garantía escrita
              </p>
            </div>
          </div>
        </section>

        {/* Value Pillars Section (GARANTIA, RAPIDEZ, PROF.) */}
        <section className="py-10 border-y border-border/50 bg-background">
          <div className="container-main">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 max-w-4xl mx-auto">
              <div className="bg-card p-6 rounded-2xl border border-border shadow-sm flex items-start gap-4 transition-all duration-300 ease-out-default hover:shadow-md">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary flex-shrink-0">
                  <Shield className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="font-semibold text-foreground text-base mb-1">Garantía Total</h4>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Todos nuestros servicios y repuestos cuentan con garantía. Tu tranquilidad es nuestro principal compromiso.
                  </p>
                </div>
              </div>
              <div className="bg-card p-6 rounded-2xl border border-border shadow-sm flex items-start gap-4 transition-all duration-300 ease-out-default hover:shadow-md">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary flex-shrink-0">
                  <Zap className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="font-semibold text-foreground text-base mb-1">Rapidez</h4>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Sabemos lo importante que es tu equipo. Ofrecemos diagnóstico en 24hs y reparaciones rápidas y eficientes.
                  </p>
                </div>
              </div>
              <div className="bg-card p-6 rounded-2xl border border-border shadow-sm flex items-start gap-4 transition-all duration-300 ease-out-default hover:shadow-md">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary flex-shrink-0">
                  <Award className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="font-semibold text-foreground text-base mb-1">Profesionalismo</h4>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Contamos con técnicos con capacitación constante y laboratorio propio equipado con tecnología de punta.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Services Grid (Boceto 2 Layout: 6 services + 1 Promo Banner + 1 CTA Banner) */}
        <section className="py-16 bg-background">
          <div className="container-main">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
              {/* Row 1: Reparación de Celulares y Consolas (Izquierda) */}
              <div className="group p-6 rounded-2xl bg-card border border-border shadow-sm hover:shadow-md transition-all duration-300 ease-out-default flex flex-col justify-between min-h-[220px]">
                <div>
                  <div className={`h-11 w-11 rounded-xl ${servicesList[0].bgColor} ${servicesList[0].color} flex items-center justify-center mb-5 group-hover:scale-105 transition-transform duration-300 ease-out-default`}>
                    <ServiceIcon0 className="h-5.5 w-5.5" />
                  </div>
                  <h3 className="text-lg font-bold mb-2 text-foreground">{servicesList[0].title}</h3>
                  <p className="text-muted-foreground leading-relaxed text-xs sm:text-sm">
                    {servicesList[0].description}
                  </p>
                </div>
                <div className="mt-4 pt-3 flex justify-end">
                  <Button asChild variant="outline" size="sm" className="rounded-full transition-all duration-100 ease-out-default active:scale-[0.96]">
                    <a href={getWhatsAppUrl(servicesList[0].title)} target="_blank" rel="noopener noreferrer">
                      <MessageCircle className="h-4 w-4 mr-2" />
                      Consultar
                    </a>
                  </Button>
                </div>
              </div>

              {/* Row 1: Mantenimiento (Derecha) */}
              <div className="group p-6 rounded-2xl bg-card border border-border shadow-sm hover:shadow-md transition-all duration-300 ease-out-default flex flex-col justify-between min-h-[220px]">
                <div>
                  <div className={`h-11 w-11 rounded-xl ${servicesList[1].bgColor} ${servicesList[1].color} flex items-center justify-center mb-5 group-hover:scale-105 transition-transform duration-300 ease-out-default`}>
                    <ServiceIcon1 className="h-5.5 w-5.5" />
                  </div>
                  <h3 className="text-lg font-bold mb-2 text-foreground">{servicesList[1].title}</h3>
                  <p className="text-muted-foreground leading-relaxed text-xs sm:text-sm">
                    {servicesList[1].description}
                  </p>
                </div>
                <div className="mt-4 pt-3 flex justify-end">
                  <Button asChild variant="outline" size="sm" className="rounded-full transition-all duration-100 ease-out-default active:scale-[0.96]">
                    <a href={getWhatsAppUrl(servicesList[1].title)} target="_blank" rel="noopener noreferrer">
                      <MessageCircle className="h-4 w-4 mr-2" />
                      Consultar
                    </a>
                  </Button>
                </div>
              </div>

              {/* Row 2: Reparación de Computadoras (Izquierda) */}
              <div className="group p-6 rounded-2xl bg-card border border-border shadow-sm hover:shadow-md transition-all duration-300 ease-out-default flex flex-col justify-between min-h-[220px]">
                <div>
                  <div className={`h-11 w-11 rounded-xl ${servicesList[2].bgColor} ${servicesList[2].color} flex items-center justify-center mb-5 group-hover:scale-105 transition-transform duration-300 ease-out-default`}>
                    <ServiceIcon2 className="h-5.5 w-5.5" />
                  </div>
                  <h3 className="text-lg font-bold mb-2 text-foreground">{servicesList[2].title}</h3>
                  <p className="text-muted-foreground leading-relaxed text-xs sm:text-sm">
                    {servicesList[2].description}
                  </p>
                </div>
                <div className="mt-4 pt-3 flex justify-end">
                  <Button asChild variant="outline" size="sm" className="rounded-full transition-all duration-100 ease-out-default active:scale-[0.96]">
                    <a href={getWhatsAppUrl(servicesList[2].title)} target="_blank" rel="noopener noreferrer">
                      <MessageCircle className="h-4 w-4 mr-2" />
                      Consultar
                    </a>
                  </Button>
                </div>
              </div>

              {/* Row 2: Armado (Derecha) */}
              <div className="group p-6 rounded-2xl bg-card border border-border shadow-sm hover:shadow-md transition-all duration-300 ease-out-default flex flex-col justify-between min-h-[220px]">
                <div>
                  <div className={`h-11 w-11 rounded-xl ${servicesList[3].bgColor} ${servicesList[3].color} flex items-center justify-center mb-5 group-hover:scale-105 transition-transform duration-300 ease-out-default`}>
                    <ServiceIcon3 className="h-5.5 w-5.5" />
                  </div>
                  <h3 className="text-lg font-bold mb-2 text-foreground">{servicesList[3].title}</h3>
                  <p className="text-muted-foreground leading-relaxed text-xs sm:text-sm">
                    {servicesList[3].description}
                  </p>
                </div>
                <div className="mt-4 pt-3 flex justify-end">
                  <Button asChild variant="outline" size="sm" className="rounded-full transition-all duration-100 ease-out-default active:scale-[0.96]">
                    <a href={getWhatsAppUrl(servicesList[3].title)} target="_blank" rel="noopener noreferrer">
                      <MessageCircle className="h-4 w-4 mr-2" />
                      Consultar
                    </a>
                  </Button>
                </div>
              </div>

              {/* Row 3: Banner publicitario ("BANN.") (Izquierda - CORREGIDO DE LOS BOCETOS) */}
              <div className="p-6 rounded-2xl bg-gradient-to-br from-primary to-secondary text-primary-foreground flex flex-col justify-between shadow-sm hover:shadow-md transition-all duration-300 ease-out-default min-h-[220px]">
                <div>
                  <span className="px-3 py-1 rounded-full bg-white/20 text-white text-[10px] font-bold uppercase tracking-wider mb-4 inline-block">
                    PROMO WHATSAPP
                  </span>
                  <h3 className="text-lg sm:text-xl font-bold mb-2 leading-tight">¿Presupuesto rápido?</h3>
                  <p className="text-white/80 text-xs sm:text-sm leading-relaxed">
                    Escribinos y cotizá la reparación de tu pantalla, módulo o pin de carga en el acto. ¡Presupuesto 100% sin cargo!
                  </p>
                </div>
                <div className="mt-4">
                  <Button asChild variant="secondary" size="sm" className="rounded-full shadow-sm transition-all duration-100 ease-out-default active:scale-[0.96] text-primary hover:bg-white">
                    <a href="https://wa.me/5493446353769?text=Hola!%20Tengo%20un%20problema%20con%20mi%20equipo%20y%20necesito%20presupuesto." target="_blank" rel="noopener noreferrer">
                      <MessageCircle className="h-4 w-4 mr-1.5" />
                      Escribir ahora
                    </a>
                  </Button>
                </div>
              </div>

              {/* Row 3: Sistemas de Seguridad (Derecha) */}
              <div className="group p-6 rounded-2xl bg-card border border-border shadow-sm hover:shadow-md transition-all duration-300 ease-out-default flex flex-col justify-between min-h-[220px]">
                <div>
                  <div className={`h-11 w-11 rounded-xl ${servicesList[4].bgColor} ${servicesList[4].color} flex items-center justify-center mb-5 group-hover:scale-105 transition-transform duration-300 ease-out-default`}>
                    <ServiceIcon4 className="h-5.5 w-5.5" />
                  </div>
                  <h3 className="text-lg font-bold mb-2 text-foreground">{servicesList[4].title}</h3>
                  <p className="text-muted-foreground leading-relaxed text-xs sm:text-sm">
                    {servicesList[4].description}
                  </p>
                </div>
                <div className="mt-4 pt-3 flex justify-end">
                  <Button asChild variant="outline" size="sm" className="rounded-full transition-all duration-100 ease-out-default active:scale-[0.96]">
                    <a href={getWhatsAppUrl(servicesList[4].title)} target="_blank" rel="noopener noreferrer">
                      <MessageCircle className="h-4 w-4 mr-2" />
                      Consultar
                    </a>
                  </Button>
                </div>
              </div>
            </div>

            {/* Row 4: Servicio Técnico CTA (Ancho completo) */}
            <div className="mt-6 max-w-4xl mx-auto">
              <div className="p-6 sm:p-8 rounded-2xl bg-muted border border-border flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <Wrench className="h-5.5 w-5.5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-foreground mb-1">Servicio Técnico General</h3>
                    <p className="text-muted-foreground text-xs sm:text-sm leading-relaxed">
                      ¿Tu equipo tiene fallas complejas o no enciende? Traelo a nuestro local. Realizamos soldaduras en placa, recuperación de equipos mojados y upgrades completos.
                    </p>
                  </div>
                </div>
                <div className="flex-shrink-0 self-end md:self-center">
                  <Button asChild size="lg" className="rounded-full shadow-sm transition-all duration-100 ease-out-default active:scale-[0.97]">
                    <a href="https://wa.me/5493446353769" target="_blank" rel="noopener noreferrer">
                      Contactar Soporte
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Contact Section (Reorganizada con Mapa en la página de servicios) */}
        <section className="py-16 bg-muted/30 border-t border-border/50">
          <div className="container-main max-w-5xl">
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">Contactanos</h2>
              <p className="text-muted-foreground text-sm">Comunicate con nosotros o visitanos en nuestras sucursales</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
              {/* Información de Contacto (Izquierda - 5/12) */}
              <div className="lg:col-span-5 flex flex-col gap-4">
                {/* Dirección */}
                <div className="bg-card p-5 rounded-2xl border border-border shadow-sm flex items-start gap-4 transition-all duration-300 ease-out-default hover:shadow-md">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary flex-shrink-0">
                    <MapPin className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground text-sm mb-1">Dirección</h4>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      Héroes de Malvinas 08, Urdinarrain, Entre Ríos<br />
                      C.5 y C.19, Gilbert, Entre Ríos<br />
                      <span className="text-[10px] font-medium opacity-80">(sucursal con local comercial)</span>
                    </p>
                  </div>
                </div>

                {/* WhatsApp */}
                <div className="bg-card p-5 rounded-2xl border border-border shadow-sm flex items-start gap-4 transition-all duration-300 ease-out-default hover:shadow-md">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary flex-shrink-0">
                    <Phone className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground text-sm mb-1">WhatsApp</h4>
                    <a
                      href="https://wa.me/5493446353769"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground text-xs sm:text-sm hover:text-primary transition-colors duration-200"
                    >
                      +54 9 3446 35-3769
                    </a>
                  </div>
                </div>

                {/* Email */}
                <div className="bg-card p-5 rounded-2xl border border-border shadow-sm flex items-start gap-4 transition-all duration-300 ease-out-default hover:shadow-md">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary flex-shrink-0">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground text-sm mb-1">Email</h4>
                    <a
                      href="mailto:nictech.urdi@gmail.com"
                      className="text-muted-foreground text-xs sm:text-sm hover:text-primary transition-colors duration-200"
                    >
                      nictech.urdi@gmail.com
                    </a>
                  </div>
                </div>

                {/* Horarios */}
                <div className="bg-card p-5 rounded-2xl border border-border shadow-sm flex items-start gap-4 transition-all duration-300 ease-out-default hover:shadow-md">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary flex-shrink-0">
                    <Clock className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground text-sm mb-1">Horarios</h4>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      Lunes a Viernes: 8:00 a 12:00 y 16:00 a 20:00<br />
                      Sábados: 9:00 a 13:00
                    </p>
                  </div>
                </div>
              </div>

              {/* Mapa Google (Derecha - 7/12) */}
              <div className="lg:col-span-7 rounded-2xl overflow-hidden bg-muted border border-border shadow-sm min-h-[350px] lg:h-auto">
                <iframe
                  src="https://maps.google.com/maps?q=H%C3%A9roes%20de%20Malvinas%2008%2C%20Urdinarrain%2C%20Entre%20R%C3%ADos%2C%20Argentina&t=&z=16&ie=UTF8&iwloc=&output=embed"
                  width="100%"
                  height="100%"
                  style={{ border: 0, minHeight: '350px' }}
                  allowFullScreen={true}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title="Ubicación Nictech - Urdinarrain"
                ></iframe>
              </div>
            </div>
          </div>
        </section>
      </Layout>
    </>
  );
};

export default Servicios;
