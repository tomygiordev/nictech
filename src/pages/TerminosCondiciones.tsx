import { Helmet } from 'react-helmet-async';
import { Layout } from '@/components/layout/Layout';

const TerminosCondiciones = () => {
    return (
        <>
            <Helmet>
                <title>Términos y Condiciones - Nictech</title>
                <meta name="robots" content="noindex, follow" />
            </Helmet>
            <Layout>
                <div className="container-main py-20 lg:py-24 bg-background">
                    <div className="max-w-3xl mx-auto">
                        <h1 className="text-3xl font-bold mb-8 text-foreground">Términos y Condiciones</h1>

                        <p className="text-muted-foreground mb-6">
                            Bienvenido a Nictech. Al acceder y utilizar nuestro sitio web y los servicios ofrecidos, aceptas cumplir con los siguientes términos y condiciones. Por favor, léelos cuidadosamente antes de realizar cualquier compra o solicitar un servicio.
                        </p>

                        <h2 className="text-xl font-semibold mt-8 mb-4 text-foreground">1. Servicios y Reparaciones</h2>
                        <p className="text-muted-foreground mb-4">
                            Los servicios técnicos ofrecidos por Nictech están sujetos a un diagnóstico inicial. El presupuesto entregado es válido por un período de 7 días hábiles. Si durante la reparación se encuentran daños adicionales no previstos en el diagnóstico, nos contactaremos para autorizar el nuevo presupuesto.
                        </p>

                        <h2 className="text-xl font-semibold mt-8 mb-4 text-foreground">2. Garantía de Reparaciones</h2>
                        <p className="text-muted-foreground mb-4">
                            Todas nuestras reparaciones cuentan con una garantía que varía según el tipo de refacción, la cual será informada al momento de la entrega del equipo. La garantía cubre única y exclusivamente la pieza reemplazada o el trabajo realizado. Excluye daños físicos posteriores, como golpes, humedad, mal uso o intervenciones por terceros.
                        </p>

                        <h2 className="text-xl font-semibold mt-8 mb-4 text-foreground">3. Tienda y Compras</h2>
                        <p className="text-muted-foreground mb-4">
                            Los precios expresados en la tienda están en Pesos Argentinos (ARS). El stock y los precios están sujetos a modificaciones sin previo aviso. En caso de no poder cumplir con la entrega de un producto abonado por falta de stock imprevista, se realizará el reembolso total de la compra.
                        </p>

                        <h2 className="text-xl font-semibold mt-8 mb-4 text-foreground">4. Envíos y Retiros</h2>
                        <p className="text-muted-foreground mb-4">
                            En Nictech ofrecemos servicio local en Urdinarrain, Entre Ríos. Las compras en tienda o equipos dejados a reparar pueden ser retirados en nuestro domicilio comercial acordando previamente. Los envíos a otras localidades corren por cuenta y riesgo del comprador mediante el servicio postal seleccionado.
                        </p>

                        <h2 className="text-xl font-semibold mt-8 mb-4 text-foreground">5. Equipos Abandonados</h2>
                        <p className="text-muted-foreground mb-4">
                            Pasados los 90 días desde que se notifica que un equipo está reparado y listo para retirar, de no mediar reclamo o pago por parte del cliente, el equipo se considerará abandonado según la normativa vigente legal en la República Argentina, otorgándole a Nictech el derecho de disponer del mismo para cubrir los costos de los repuestos, almacenaje y mano de obra.
                        </p>

                        <h2 className="text-xl font-semibold mt-8 mb-4 text-foreground">6. Medios de Pago</h2>
                        <p className="text-muted-foreground mb-4">
                            Se aceptan pagos en efectivo, transferencia bancaria y MercadoPago según las condiciones indicadas al momento del checkout.
                        </p>

                    </div>
                </div>
            </Layout>
        </>
    );
};

export default TerminosCondiciones;
