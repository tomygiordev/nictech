import { Helmet } from 'react-helmet-async';
import { Smartphone, Battery, CircuitBoard, Unlock, Laptop, Monitor, Tablet, HardDrive, Sparkles, Building2, ShieldCheck, MessageCircle } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';

const services = [
  {
    icon: Smartphone,
    title: 'Cambio de Pantalla',
    description: 'Pantallas nuevas con instalación profesional y garantía.',
    popular: true,
  },
  {
    icon: Battery,
    title: 'Cambio de Batería',
    description: 'Baterías nuevas para mejorar rendimiento y autonomía.',
    popular: true,
  },
  {
    icon: CircuitBoard,
    title: 'Reparación de Celulares (Hardware y Software)',
    description: 'Solución de fallas electrónicas, placa, carga, audio, señal y sistema.',
    popular: true,
  },
  {
    icon: Unlock,
    title: 'Desbloqueos y Liberaciones',
    description: 'Netbooks del gobierno, FRP (cuenta Google) e iPhone.',
    popular: false,
  },
  {
    icon: Laptop,
    title: 'Reparación de Computadoras y Notebooks',
    description: 'Diagnóstico, reparación, optimización y mantenimiento integral.',
    popular: false,
  },
  {
    icon: Monitor,
    title: 'Armado de Computadoras a Medida',
    description: 'PCs personalizadas según tu uso: oficina, estudio o gaming.',
    popular: false,
  },
  {
    icon: Tablet,
    title: 'Reparación de Tablets',
    description: 'Pantallas, baterías, software y reparaciones electrónicas.',
    popular: false,
  },
  {
    icon: HardDrive,
    title: 'Recuperación de Datos',
    description: 'Rescatamos tu información de dispositivos dañados.',
    popular: false,
  },
  {
    icon: Sparkles,
    title: 'Mantenimiento Preventivo (Particulares)',
    description: 'Limpieza interna, cambio de pasta térmica y optimización.',
    popular: false,
  },
  {
    icon: Building2,
    title: 'Servicio Técnico para Empresas y Comercios',
    description: 'Mantenimiento preventivo, soporte técnico y asistencia integral para oficinas, comercios y pymes.',
    popular: false,
  },
  {
    icon: ShieldCheck,
    title: 'Sistemas de Seguridad y Videovigilancia',
    description: 'Instalación, configuración y mantenimiento de cámaras de seguridad para hogares, comercios y empresas.',
    popular: false,
  },
];

const Servicios = () => {
  const getWhatsAppUrl = (service: string) => {
    const phoneNumber = '5493446353769';
    const message = encodeURIComponent(`Hola! Me interesa obtener más información sobre el servicio de: *${service}*`);
    return `https://wa.me/${phoneNumber}?text=${message}`;
  };

  return (
    <>
      <Helmet>
        <title>Servicios de Reparación - Nictech | Lima, Perú</title>
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

                  <div className="flex justify-end pt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full sm:w-auto"
                      asChild
                    >
                      <a
                        href={getWhatsAppUrl(service.title)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MessageCircle className="h-4 w-4 mr-2" />
                        Consultar
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
                  href="https://wa.me/5493446353769"
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
