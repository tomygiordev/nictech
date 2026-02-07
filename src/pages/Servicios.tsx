import { Helmet } from 'react-helmet-async';
import { Smartphone, Laptop, Tablet, HardDrive, Battery, Monitor, Wrench, MessageCircle } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';

const services = [
  {
    icon: Smartphone,
    title: 'Reparación de Smartphones',
    description: 'Cambio de pantalla, batería, carga, botones y más para todas las marcas.',
    price: 'Desde S/ 80',
    popular: true,
  },
  {
    icon: Laptop,
    title: 'Reparación de Laptops',
    description: 'Diagnóstico, cambio de disco, RAM, teclado, pantalla y mantenimiento general.',
    price: 'Desde S/ 100',
    popular: false,
  },
  {
    icon: Tablet,
    title: 'Reparación de Tablets',
    description: 'Servicio especializado para iPad, Samsung Galaxy Tab y otras marcas.',
    price: 'Desde S/ 90',
    popular: false,
  },
  {
    icon: HardDrive,
    title: 'Recuperación de Datos',
    description: 'Recuperamos tus archivos de discos duros, USB, memorias SD y dispositivos dañados.',
    price: 'Desde S/ 150',
    popular: true,
  },
  {
    icon: Battery,
    title: 'Cambio de Batería',
    description: 'Baterías originales y compatibles con garantía para smartphones y laptops.',
    price: 'Desde S/ 60',
    popular: false,
  },
  {
    icon: Monitor,
    title: 'Cambio de Pantalla',
    description: 'Pantallas LCD y OLED originales con instalación profesional.',
    price: 'Desde S/ 120',
    popular: false,
  },
  {
    icon: Wrench,
    title: 'Mantenimiento Preventivo',
    description: 'Limpieza interna, cambio de pasta térmica y optimización de rendimiento.',
    price: 'Desde S/ 50',
    popular: false,
  },
];

const Servicios = () => {
  const phoneNumber = '51999888777';
  const getWhatsAppUrl = (service: string) => {
    const message = encodeURIComponent(`Hola, me interesa el servicio de: ${service}. ¿Podrían darme más información?`);
    return `https://wa.me/${phoneNumber}?text=${message}`;
  };

  return (
    <>
      <Helmet>
        <title>Servicios de Reparación - NicTech | Lima, Perú</title>
        <meta name="description" content="Servicios profesionales de reparación: smartphones, laptops, tablets, recuperación de datos. Soporte certificado con garantía." />
      </Helmet>
      <Layout>
        {/* Header */}
        <section className="bg-muted/50 py-12 lg:py-16">
          <div className="container-main">
            <div className="text-center max-w-2xl mx-auto">
              <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
                Servicios
              </span>
              <h1 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
                Nuestros Servicios
              </h1>
              <p className="text-muted-foreground text-lg">
                Soluciones profesionales para todos tus dispositivos tecnológicos
              </p>
            </div>
          </div>
        </section>

        {/* Services Grid */}
        <section className="py-12 lg:py-16">
          <div className="container-main">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {services.map((service, index) => (
                <div
                  key={service.title}
                  className="group relative bg-card rounded-2xl border border-border p-6 card-hover animate-slide-up"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  {service.popular && (
                    <span className="absolute -top-3 right-6 px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-medium">
                      Popular
                    </span>
                  )}

                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-300">
                    <service.icon className="h-6 w-6" />
                  </div>

                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    {service.title}
                  </h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    {service.description}
                  </p>

                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold text-primary">
                      {service.price}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                    >
                      <a
                        href={getWhatsAppUrl(service.title)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MessageCircle className="h-4 w-4 mr-2" />
                        Cotizar
                      </a>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-12 lg:py-16 bg-muted/50">
          <div className="container-main">
            <div className="text-center max-w-2xl mx-auto">
              <h2 className="text-2xl lg:text-3xl font-bold text-foreground mb-4">
                ¿No encuentras lo que buscas?
              </h2>
              <p className="text-muted-foreground mb-6">
                Contáctanos y te ayudaremos con cualquier problema técnico
              </p>
              <Button asChild size="lg">
                <a
                  href={`https://wa.me/${phoneNumber}?text=${encodeURIComponent('Hola, necesito ayuda con un problema técnico.')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle className="h-5 w-5 mr-2" />
                  Contactar por WhatsApp
                </a>
              </Button>
            </div>
          </div>
        </section>
      </Layout>
    </>
  );
};

export default Servicios;
