import { Helmet } from 'react-helmet-async';
import { Calendar, ArrowRight, Clock } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';

const blogPosts = [
  {
    id: 1,
    title: '5 Señales de que tu Smartphone Necesita Reparación',
    excerpt: 'Aprende a identificar los síntomas que indican que tu teléfono necesita atención profesional antes de que sea demasiado tarde.',
    image: 'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=600',
    date: '2024-01-15',
    readTime: '5 min',
    category: 'Consejos',
  },
  {
    id: 2,
    title: 'Cómo Prolongar la Vida Útil de tu Laptop',
    excerpt: 'Tips prácticos para mantener tu laptop funcionando como nueva por más tiempo y evitar reparaciones costosas.',
    image: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600',
    date: '2024-01-10',
    readTime: '7 min',
    category: 'Mantenimiento',
  },
  {
    id: 3,
    title: 'La Importancia del Mantenimiento Preventivo',
    excerpt: 'Descubre por qué el mantenimiento regular puede ahorrarte dinero y prolongar la vida de tus dispositivos.',
    image: 'https://images.unsplash.com/photo-1581092921461-eab62e97a780?w=600',
    date: '2024-01-05',
    readTime: '4 min',
    category: 'Educación',
  },
  {
    id: 4,
    title: 'Nuevas Tendencias en Tecnología 2024',
    excerpt: 'Las últimas innovaciones en smartphones, laptops y dispositivos que marcarán tendencia este año.',
    image: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=600',
    date: '2024-01-01',
    readTime: '6 min',
    category: 'Tendencias',
  },
];

const Blog = () => {
  return (
    <>
      <Helmet>
        <title>Blog - NicTech | Consejos y Noticias de Tecnología</title>
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
                  className="group bg-card rounded-2xl border border-border overflow-hidden card-hover animate-slide-up"
                  style={{ animationDelay: `${index * 100}ms` }}
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
                        {new Date(post.date).toLocaleDateString('es-PE', {
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
      </Layout>
    </>
  );
};

export default Blog;
