import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { MapPin, Phone, Mail, Clock, Send, Loader2 } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';

const Contacto = () => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    message: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Simulate form submission
    await new Promise(resolve => setTimeout(resolve, 1000));

    toast({
      title: '¡Mensaje enviado!',
      description: 'Te contactaremos pronto. Gracias por escribirnos.',
    });

    setFormData({ name: '', email: '', phone: '', message: '' });
    setLoading(false);
  };

  return (
    <>
      <Helmet>
        <title>Contacto - NicTech | Atención al Cliente</title>
        <meta name="description" content="Contáctanos para cotizaciones, consultas o soporte técnico. Estamos aquí para ayudarte con tus dispositivos." />
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
                ¿Tienes alguna pregunta? Estamos aquí para ayudarte
              </p>
            </div>
          </div>
        </section>

        {/* Contact Content */}
        <section className="py-12 lg:py-16">
          <div className="container-main">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
              {/* Contact Info */}
              <div>
                <h2 className="text-2xl font-bold text-foreground mb-6">
                  Información de Contacto
                </h2>
                
                <div className="space-y-6 mb-8">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary flex-shrink-0">
                      <MapPin className="h-6 w-6" />
                    </div>
                    <div>
                      <h4 className="font-medium text-foreground mb-1">Dirección</h4>
                      <p className="text-muted-foreground">
                        Av. Tecnología 123, Miraflores<br />
                        Lima, Perú
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary flex-shrink-0">
                      <Phone className="h-6 w-6" />
                    </div>
                    <div>
                      <h4 className="font-medium text-foreground mb-1">Teléfono</h4>
                      <p className="text-muted-foreground">+51 999 888 777</p>
                      <p className="text-muted-foreground">+51 (01) 234 5678</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary flex-shrink-0">
                      <Mail className="h-6 w-6" />
                    </div>
                    <div>
                      <h4 className="font-medium text-foreground mb-1">Email</h4>
                      <p className="text-muted-foreground">info@nictech.pe</p>
                      <p className="text-muted-foreground">soporte@nictech.pe</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary flex-shrink-0">
                      <Clock className="h-6 w-6" />
                    </div>
                    <div>
                      <h4 className="font-medium text-foreground mb-1">Horario de Atención</h4>
                      <p className="text-muted-foreground">Lunes - Viernes: 9:00 - 19:00</p>
                      <p className="text-muted-foreground">Sábado: 9:00 - 14:00</p>
                    </div>
                  </div>
                </div>

                {/* Map placeholder */}
                <div className="rounded-2xl overflow-hidden bg-muted h-64 flex items-center justify-center">
                  <p className="text-muted-foreground">Mapa próximamente</p>
                </div>
              </div>

              {/* Contact Form */}
              <div>
                <div className="bg-card rounded-2xl border border-border p-8 shadow-card">
                  <h2 className="text-2xl font-bold text-foreground mb-6">
                    Envíanos un Mensaje
                  </h2>
                  
                  <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-2">
                      <Label htmlFor="name">Nombre completo</Label>
                      <Input
                        id="name"
                        type="text"
                        placeholder="Tu nombre"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                        className="h-12"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          placeholder="tu@email.com"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          required
                          className="h-12"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone">Teléfono</Label>
                        <Input
                          id="phone"
                          type="tel"
                          placeholder="+51 999 999 999"
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          className="h-12"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="message">Mensaje</Label>
                      <Textarea
                        id="message"
                        placeholder="¿En qué podemos ayudarte?"
                        value={formData.message}
                        onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                        required
                        rows={5}
                      />
                    </div>

                    <Button type="submit" className="w-full" size="lg" disabled={loading}>
                      {loading ? (
                        <Loader2 className="h-5 w-5 animate-spin mr-2" />
                      ) : (
                        <Send className="h-5 w-5 mr-2" />
                      )}
                      Enviar Mensaje
                    </Button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </section>
      </Layout>
    </>
  );
};

export default Contacto;
