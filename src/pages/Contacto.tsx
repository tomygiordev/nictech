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
          <div className="container-main max-w-4xl">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
              {/* Contact Info Cards */}
              <div className="bg-card p-6 rounded-2xl border border-border shadow-sm flex flex-col items-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary mb-4">
                  <MapPin className="h-6 w-6" />
                </div>
                <h4 className="font-medium text-foreground mb-2">Dirección</h4>
                <p className="text-muted-foreground">
                  Calle 19 y 5 (Esquina)<br />
                  Urdinarrain y Gilbert, Entre Ríos
                </p>
              </div>

              <div className="bg-card p-6 rounded-2xl border border-border shadow-sm flex flex-col items-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary mb-4">
                  <Phone className="h-6 w-6" />
                </div>
                <h4 className="font-medium text-foreground mb-2">WhatsApp / Teléfono</h4>
                <a
                  href="https://api.whatsapp.com/message/2KHIZHSIAZETK1?autoload=1&app_absent=0"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary transition-colors"
                >
                  +54 9 3446 35-3769
                </a>
              </div>

              <div className="bg-card p-6 rounded-2xl border border-border shadow-sm flex flex-col items-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary mb-4">
                  <Mail className="h-6 w-6" />
                </div>
                <h4 className="font-medium text-foreground mb-2">Email</h4>
                <a href="mailto:nictech.urdi@gmail.com" className="text-muted-foreground hover:text-primary transition-colors">
                  nictech.urdi@gmail.com
                </a>
              </div>
            </div>

            {/* Map */}
            <div className="rounded-2xl overflow-hidden bg-muted border border-border shadow-sm h-[300px] lg:h-[450px]">
              <iframe
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d342.5160463048138!2d-58.92949946250626!3d-32.5342748362853!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x95b0532973e3c1a7%3A0xb85a3859280c0f1a!2sDespensa%20de%20Juan%20Carlos%20orsinger!5e1!3m2!1sen!2sar!4v1770589996889!5m2!1sen!2sar"
                width="100%"
                height="100%"
                style={{ border: 0 }}
                allowFullScreen={true}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="Ubicación Nictech - Gilbert"
              ></iframe>
            </div>

          </div>
        </section>
      </Layout>
    </>
  );
};

export default Contacto;
