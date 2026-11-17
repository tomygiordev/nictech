import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ShoppingBag, Wrench } from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <>
      <Helmet>
        <title>Página no encontrada | Nictech</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <Layout>
        <section className="flex min-h-[65vh] items-center justify-center bg-muted/40 py-16 px-4">
          <div className="max-w-lg w-full text-center bg-card border border-border rounded-2xl p-6 sm:p-10 shadow-sm">
            <span className="inline-block px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold mb-4">
              Error 404
            </span>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">
              Página no encontrada
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground mb-8 leading-relaxed">
              El enlace que estás buscando no existe o fue movido. Podés explorar nuestro catálogo de productos o consultar por nuestro servicio técnico.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
              <Button asChild size="lg" className="min-h-[44px] gap-2 rounded-xl">
                <Link to="/tienda">
                  <ShoppingBag className="h-4 w-4 shrink-0" />
                  Ir a la Tienda
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="min-h-[44px] gap-2 rounded-xl">
                <Link to="/servicios">
                  <Wrench className="h-4 w-4 shrink-0" />
                  Servicio Técnico
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </Layout>
    </>
  );
};

export default NotFound;
