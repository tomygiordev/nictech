import { Helmet } from 'react-helmet-async';
import { Layout } from '@/components/layout/Layout';

const PoliticasPrivacidad = () => {
    return (
        <>
            <Helmet>
                <title>Políticas de Privacidad - Nictech</title>
                <meta name="robots" content="noindex, follow" />
            </Helmet>
            <Layout>
                <div className="container-main py-20 lg:py-24 bg-background">
                    <div className="max-w-3xl mx-auto">
                        <h1 className="text-3xl font-bold mb-8 text-foreground">Políticas de Privacidad</h1>

                        <p className="text-muted-foreground mb-6">
                            En Nictech, valoramos y respetamos tu privacidad. Esta política explica cómo recopilamos, usamos, protegemos y compartimos tu información personal al utilizar nuestra tienda online y nuestros servicios de reparación técnica, de acuerdo con la Ley de Protección de Datos Personales (Ley 25.326) de la República Argentina.
                        </p>

                        <h2 className="text-xl font-semibold mt-8 mb-4 text-foreground">1. Información que recopilamos</h2>
                        <ul className="list-disc pl-5 text-muted-foreground mb-4 space-y-2">
                            <li><strong>Datos de contacto:</strong> Nombre, apellido, correo electrónico y número de teléfono (ej. WhatsApp).</li>
                            <li><strong>Datos de equipo:</strong> Contraseñas o patrones de desbloqueo provistos temporalmente por el cliente única y exclusivamente con el fin de realizar testeos y reparaciones sobre el software/hardware del equipo entregado.</li>
                            <li><strong>Datos de facturación:</strong> Si realizas compras, requeriremos dirección de envío e información pertinente al pago (no guardamos números completos de tarjetas, ya que los procesos de pagos son manejados de forma segura a través de integraciones como MercadoPago).</li>
                        </ul>

                        <h2 className="text-xl font-semibold mt-8 mb-4 text-foreground">2. Uso de tu Información</h2>
                        <p className="text-muted-foreground mb-4">
                            La información recopilada es empleada exclusivamente para:
                        </p>
                        <ul className="list-disc pl-5 text-muted-foreground mb-4 space-y-2">
                            <li>Proveer los servicios de reparación solicitados.</li>
                            <li>Procesar las compras en nuestra tienda y organizar envíos.</li>
                            <li>Contactarte para enviar avisos de estado de reparaciones, cambios en presupuestos, o detalles sobre tu compra.</li>
                        </ul>

                        <h2 className="text-xl font-semibold mt-8 mb-4 text-foreground">3. Confidencialidad sobre Equipos Personales</h2>
                        <p className="text-muted-foreground mb-4">
                            Entendemos que los celulares, laptops y otros dispositivos contienen material altamente sensible y privado. Los técnicos de Nictech acceden a la información del sistema de manera estrictamente funcional (verificar pantalla, cámaras, audios, conectividad) sin revisar, copiar ni almacenar galerías de fotos, chats personales, o documentos privados del cliente.
                        </p>

                        <h2 className="text-xl font-semibold mt-8 mb-4 text-foreground">4. Derechos del Titular de los Datos</h2>
                        <p className="text-muted-foreground mb-4">
                            En base a la legislación argentina, tienes el derecho de solicitar el acceso, rectificación, actualización o supresión de tus datos personales alojados en nuestra base en cualquier momento, enviando un correo a <strong>nictech.urdi@gmail.com</strong>.
                        </p>

                        <h2 className="text-xl font-semibold mt-8 mb-4 text-foreground">5. Seguridad</h2>
                        <p className="text-muted-foreground mb-4">
                            Nos esforzamos por mantener la seguridad de tus datos, empleando medidas y servicios de hosting confiables para protegerlos de accesos no autorizados. Sin embargo, recuerda que ninguna transmisión por internet es 100% segura e infalible.
                        </p>
                    </div>
                </div>
            </Layout>
        </>
    );
};

export default PoliticasPrivacidad;
