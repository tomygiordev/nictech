import { Helmet } from 'react-helmet-async';
import { Layout } from '@/components/layout/Layout';
import { HeroSection } from '@/components/home/HeroSection';
import { WhyChooseUs } from '@/components/home/WhyChooseUs';
import { Testimonials } from '@/components/home/Testimonials';

const Index = () => {
  return (
    <>
      <Helmet>
        <title>Nictech - Reparación de Tecnología y Tienda | Entre Ríos, Argentina</title>
        <meta name="description" content="Especialidad en reparación de smartphones, laptops y tablets. Tienda de tecnología con garantía. Compromiso con la excelencia en Lima, Perú." />
      </Helmet>
      <Layout>
        <HeroSection />
        <WhyChooseUs />
        <Testimonials />
      </Layout>
    </>
  );
};

export default Index;
