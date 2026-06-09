import { Helmet } from 'react-helmet-async';
import { MapPin, Phone, Mail, Clock } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';

const Contacto = () => {
  return (
    <>
      <Helmet>
        <title>Contacto - Nictech | Atención al Cliente</title>
        <meta name="description" content="Contáctanos para cotizaciones, consultas o soporte técnico. Estamos aquí para ayudarte con tus dispositivos en Urdinarrain y Gilbert." />
      </Helmet>
      <Layout>
        {/* Header */}
        <section className="bg-muted/50 py-12 lg:py-16">
          <div className="container-main">
            <div className="text-center max-w-2xl mx-auto">
              <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
                Contacto
              </span>
              <h1 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
                Contáctanos
              </h1>
              <p className="text-muted-foreground text-lg">
                Visítanos en nuestro local o comunícate con nosotros
              </p>
            </div>
          </div>
        </section>

        {/* Contact Content */}
        <section className="py-12 lg:py-16">
          <div className="container-main max-w-5xl">
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

export default Contacto;
