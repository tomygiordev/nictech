import { Smartphone, Laptop } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

const services = [
    {
        id: 1,
        title: 'Celulares y Tablets',
        description: 'Cambio de módulos, baterías, pines de carga y reparaciones en placa para todas las marcas.',
        icon: Smartphone,
        color: 'text-blue-500',
        bgColor: 'bg-blue-500/10'
    },
    {
        id: 2,
        title: 'PCs y Notebooks',
        description: 'Formateos, instalación de sistemas, limpieza física, cambio de pasta térmica y upgrades de hardware.',
        icon: Laptop,
        color: 'text-orange-500',
        bgColor: 'bg-orange-500/10'
    }
];

export const OurServices = () => {
    return (
        <section className="py-20 lg:py-24 bg-background">
            <div className="container-main">
                {/* Header */}
                <div className="text-center max-w-2xl mx-auto mb-12 lg:mb-16">
                    <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
                        Nuestros Servicios
                    </span>
                    <h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
                        Especialistas en darle vida a tu tecnología
                    </h2>
                    <p className="text-muted-foreground text-lg">
                        Abarcamos todas las soluciones que tu equipo necesita, desde un simple mantenimiento hasta reparaciones avanzadas.
                    </p>
                </div>

                {/* Services Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
                    {services.map((service, index) => (
                        <div
                            key={service.id}
                            className="group p-6 rounded-2xl bg-card border border-border shadow-sm hover:shadow-md transition-all duration-300 animate-slide-up"
                            style={{ animationDelay: `${index * 100}ms` }}
                        >
                            <div className={`h-12 w-12 rounded-xl ${service.bgColor} ${service.color} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                                <service.icon className="h-6 w-6" />
                            </div>
                            <h3 className="text-xl font-semibold mb-3 text-foreground">{service.title}</h3>
                            <p className="text-muted-foreground leading-relaxed text-sm mb-6">
                                {service.description}
                            </p>
                        </div>
                    ))}
                </div>

                <div className="mt-12 text-center animate-slide-up" style={{ animationDelay: '400ms' }}>
                    <Button asChild size="lg" className="rounded-full">
                        <Link to="/tienda">
                            Explorar nuestra tienda
                        </Link>
                    </Button>
                </div>
            </div>
        </section>
    );
};
