import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Calendar, ArrowRight, Clock, User, Tag } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const blogPosts = [
  {
    id: 1,
    title: '5 Señales de que tu Smartphone Necesita Reparación',
    excerpt: 'Aprende a identificar los síntomas que indican que tu teléfono necesita atención profesional antes de que sea demasiado tarde.',
    content: `
      <p>Tu smartphone es una herramienta esencial en tu día a día, y detectar problemas a tiempo puede salvarte de una reparación mucho más costosa o incluso de la pérdida total del dispositivo.</p>
      
      <h3>1. La batería se agota volando</h3>
      <p>Si notás que pasás más tiempo pegado al cargador que usando el celu, es probable que la vida útil de tu batería esté llegando a su fin. Las baterías tienen ciclos de carga limitados y, después de un par de años, es normal que empiecen a fallar.</p>

      <h3>2. Pantalla con "fantasmas" o líneas raras</h3>
      <p>No esperes a que la pantalla se ponga negra. Si aparecen líneas de colores o manchas, el panel LCD u OLED está sufriendo. Cambiarlo a tiempo evita que el daño pase a la placa madre.</p>

      <h3>3. Se calienta sin razón aparente</h3>
      <p>¿Tu celu quema cuando estás solo en WhatsApp? Eso puede ser una señal de procesos en corto o una batería hinchada. Ojo con esto, porque puede ser peligroso.</p>

      <h3>4. Aplicaciones que se cierran solas</h3>
      <p>Si de la nada las apps se clavan, puede ser un tema de software, pero también de memoria RAM fallando o almacenamiento corrupto.</p>

      <h3>5. El táctil no responde bien</h3>
      <p>Si tenés que apretar cinco veces para que te tome una letra, el digitalizador está pidiendo pista. Un cambio rápido de módulo y queda como nuevo.</p>

      <p><strong>En Nictech diagnosticamos tu equipo sin cargo. ¡Traelo y lo revisamos en un toque!</strong></p>
    `,
    image: 'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=800',
    date: '2026-01-15',
    readTime: '5 min',
    category: 'Consejos',
    author: 'Nico de Nictech'
  },
  {
    id: 2,
    title: 'Cómo Prolongar la Vida Útil de tu Laptop',
    excerpt: 'Tips prácticos para mantener tu laptop funcionando como nueva por más tiempo y evitar reparaciones costosas.',
    content: `
      <p>Una laptop es una inversión importante. Ya sea para estudiar o trabajar, querés que te dure lo máximo posible. Acá te dejo los mejores tips para cuidarla como se debe.</p>
      
      <h3>La limpieza es clave</h3>
      <p>El polvo es el enemigo número uno. Se mete por los ventiladores y hace que la temperatura suba. Una limpieza interna una vez al año y cambio de pasta térmica es la diferencia entre una laptop que vuela y una que se quema.</p>

      <h3>Cuidado con los ciclos de batería</h3>
      <p>No la dejes conectada al 100% todo el tiempo, pero tampoco dejes que se muera en 0%. Lo ideal para la salud de la batería es mantenerla entre el 20% y el 80%.</p>

      <h3>Ojo donde la apoyás</h3>
      <p>Nunca, pero nunca, uses la laptop sobre la cama o un almohadón. Tapás la ventilación y la terminás cocinando. Siempre sobre superficies planas y duras.</p>

      <h3>Actualizá a un SSD</h3>
      <p>Si tu laptop tiene unos años y anda lenta, no la tires. Cambiar el disco viejo por un SSD le da una vida nueva. Es impresionante la diferencia de velocidad.</p>

      <p><strong>¿Tu laptop hace ruido de avión o calienta mucho? Traela a Nictech para un mantenimiento preventivo.</strong></p>
    `,
    image: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=800',
    date: '2026-01-10',
    readTime: '7 min',
    category: 'Mantenimiento',
    author: 'Nico de Nictech'
  },
  {
    id: 3,
    title: 'La Importancia del Mantenimiento Preventivo',
    excerpt: 'Descubre por qué el mantenimiento regular puede ahorrarte dinero y prolongar la vida de tus dispositivos.',
    content: `
      <p>Muchas veces esperamos a que algo se rompa para llevarlo al técnico. El problema es que, cuando algo se rompe, suele ser mucho más caro arreglarlo que haberlo prevenido.</p>
      
      <h3>Ahorro de guita a largo plazo</h3>
      <p>Un cambio de pasta térmica sale dos mangos comparado con lo que sale cambiar un procesador o una placa de video quemada por sobrecalentamiento.</p>

      <h3>Mejor rendimiento</h3>
      <p>Con el tiempo, el sistema se llena de basura y los componentes de tierra. Un service completo hace que tu equipo rinda lo que tiene que rendir, sin tirones ni esperas eternas.</p>

      <h3>Seguridad de tus datos</h3>
      <p>En un mantenimiento preventivo revisamos la salud de tu disco. Avisarte que tu disco está por morir te da tiempo de salvar tus fotos y archivos antes de que sea tarde.</p>

      <p>En Nictech creemos que la prevención es la mejor herramienta. ¡Consultanos por packs locales de mantenimiento!</p>
    `,
    image: 'https://images.unsplash.com/photo-1581092921461-eab62e97a780?w=800',
    date: '2026-01-05',
    readTime: '4 min',
    category: 'Educación',
    author: 'Nico de Nictech'
  },
  {
    id: 4,
    title: 'Nuevas Tendencias en Tecnología 2026',
    excerpt: 'Las últimas innovaciones en smartphones, laptops y dispositivos que marcarán tendencia este año.',
    content: `
      <p>El 2026 viene cargado de novedades que van a cambiar cómo usamos la tecnología en el día a día. Acá te cuento lo más importante.</p>
      
      <h3>IA en todos lados</h3>
      <p>Ya no es solo un chat. Ahora los procesadores de los celus y laptops vienen optimizados para correr modelos de IA localmente, mejorando la edición de fotos, la traducción en tiempo real y la autonomía de la batería.</p>

      <h3>Pantallas plegables maduras</h3>
      <p>Los plegables dejaron de ser un lujo frágil. Los nuevos modelos son más resistentes que nunca y el pliegue es casi invisible. ¿Será este el año en que todos tengamos uno?</p>

      <h3>Carga ultra rápida estándar</h3>
      <p>Cargar el celu en 15 minutos ya es una realidad en la gama media y alta. Se acabaron las preocupaciones por salir de casa con poca batería.</p>

      <p>Mantenete conectado con Nictech para enterarte de todas las novedades y conseguir lo último en tecnología.</p>
    `,
    image: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800',
    date: '2026-01-01',
    readTime: '6 min',
    category: 'Tendencias',
    author: 'Nico de Nictech'
  },
];

const Blog = () => {
  const [selectedPost, setSelectedPost] = useState<typeof blogPosts[0] | null>(null);

  return (
    <>
      <Helmet>
        <title>Blog - Nictech | Consejos y Noticias de Tecnología</title>
        <meta name="description" content="Consejos de reparación, mantenimiento y las últimas noticias del mundo tecnológico. Aprende a cuidar tus dispositivos." />
      </Helmet>
      <Layout>
        {/* Header */}
        <section className="bg-muted/50 py-12 lg:py-16">
          <div className="container-main">
            <div className="text-center max-w-2xl mx-auto">
              <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
                Blog
              </span>
              <h1 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
                Nuestro Blog
              </h1>
              <p className="text-muted-foreground text-lg">
                Consejos, tutoriales y las últimas noticias del mundo tecnológico
              </p>
            </div>
          </div>
        </section>

        {/* Blog Posts */}
        <section className="py-12 lg:py-16">
          <div className="container-main">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {blogPosts.map((post, index) => (
                <article
                  key={post.id}
                  className="group bg-card rounded-2xl border border-border overflow-hidden card-hover animate-slide-up cursor-pointer"
                  style={{ animationDelay: `${index * 100}ms` }}
                  onClick={() => setSelectedPost(post)}
                >
                  {/* Image */}
                  <div className="relative aspect-video overflow-hidden">
                    <img
                      src={post.image}
                      alt={post.title}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                    <div className="absolute top-4 left-4">
                      <span className="px-3 py-1 rounded-full bg-background/90 backdrop-blur-sm text-xs font-medium text-foreground">
                        {post.category}
                      </span>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="p-6">
                    <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        {new Date(post.date).toLocaleDateString('es-AR', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {post.readTime}
                      </span>
                    </div>

                    <h2 className="text-xl font-semibold text-foreground mb-3 group-hover:text-primary transition-colors">
                      {post.title}
                    </h2>
                    <p className="text-muted-foreground mb-4 line-clamp-2">
                      {post.excerpt}
                    </p>

                    <Button variant="ghost" className="p-0 h-auto font-medium text-primary hover:text-primary/80">
                      Leer más
                      <ArrowRight className="h-4 w-4 ml-2 transition-transform group-hover:translate-x-1" />
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Blog Post Modal */}
        <Dialog open={!!selectedPost} onOpenChange={(open) => !open && setSelectedPost(null)}>
          {/* Agregamos una clase para quitar el foco por defecto si molesta, pero lo importante es el wrapper interno */}
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0 gap-0 border-none transition-all duration-300">
            {selectedPost && (
              // SOLUCIÓN: Envolver todo en un div flex-col para mantener el flujo normal
              <div className="flex flex-col relative">

                {/* Header / Imagen */}
                <div className="relative aspect-video w-full overflow-hidden shrink-0">
                  <img
                    src={selectedPost.image}
                    alt={selectedPost.title}
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-8 lg:p-12">
                    <div className="space-y-4">
                      <div className="flex gap-2">
                        <span className="px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-medium">
                          {selectedPost.category}
                        </span>
                      </div>
                      {/* Usamos DialogTitle aquí para accesibilidad, aunque visualmente ya es un h2 */}
                      <DialogTitle className="text-2xl lg:text-4xl font-bold text-white leading-tight">
                        {selectedPost.title}
                      </DialogTitle>
                    </div>
                  </div>
                </div>

                {/* Cuerpo del Contenido */}
                <div className="p-8 lg:p-12 bg-card">
                  <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground mb-8 border-b border-border pb-6">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        <User className="h-4 w-4" />
                      </div>
                      <span className="font-medium text-foreground">{selectedPost.author}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      {new Date(selectedPost.date).toLocaleDateString('es-AR', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      {selectedPost.readTime} de lectura
                    </div>
                  </div>

                  <div
                    className="prose prose-lg dark:prose-invert max-w-none 
                    prose-headings:text-foreground prose-p:text-muted-foreground 
                    prose-strong:text-foreground prose-h3:text-xl lg:prose-h3:text-2xl 
                    prose-h3:font-bold prose-h3:mt-8 prose-h3:mb-4
                    space-y-4 text-foreground leading-relaxed content-rich-text"
                    dangerouslySetInnerHTML={{ __html: selectedPost.content }}
                  />

                  <div className="mt-12 pt-8 border-t border-border flex justify-between items-center">
                    <div className="flex items-center gap-2 text-primary font-medium">
                      <Tag className="h-4 w-4" />
                      <span className="text-sm">{selectedPost.category}</span>
                    </div>
                    <Button variant="outline" onClick={() => setSelectedPost(null)}>
                      Cerrar
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </Layout>
    </>
  );
};

export default Blog;
