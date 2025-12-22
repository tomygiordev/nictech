import { Shield, Zap, Award } from 'lucide-react';

const features = [
  {
    icon: Shield,
    title: 'Garantía Total',
    description: 'Todos nuestros servicios incluyen garantía. Tu inversión está protegida.',
  },
  {
    icon: Zap,
    title: 'Rapidez',
    description: 'Diagnóstico en 24 horas y reparaciones express disponibles.',
  },
  {
    icon: Award,
    title: 'Profesionalismo',
    description: 'Técnicos certificados con más de 10 años de experiencia.',
  },
];

export const WhyChooseUs = () => {
  return (
    <section className="py-20 lg:py-24 bg-muted/50">
      <div className="container-main">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-12 lg:mb-16">
          <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            ¿Por qué elegirnos?
          </span>
          <h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
            Confía en los expertos
          </h2>
          <p className="text-muted-foreground text-lg">
            Miles de clientes satisfechos respaldan nuestra calidad y compromiso
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              className="group relative p-8 rounded-2xl bg-card border border-border card-hover animate-slide-up"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              {/* Icon */}
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary mb-6 group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-300">
                <feature.icon className="h-7 w-7" />
              </div>

              {/* Content */}
              <h3 className="text-xl font-semibold text-foreground mb-3">
                {feature.title}
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                {feature.description}
              </p>

              {/* Hover indicator */}
              <div className="absolute bottom-0 left-0 h-1 w-0 bg-primary rounded-b-2xl transition-all duration-300 group-hover:w-full" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
