import { Helmet } from 'react-helmet-async';
import { Layout } from '@/components/layout/Layout';
import { HeroSection } from '@/components/home/HeroSection';
import { WhyChooseUs } from '@/components/home/WhyChooseUs';
import { Testimonials } from '@/components/home/Testimonials';

const Index = () => {
  return (
    <>
      <Helmet>
        <title>NicTech - Reparación de Tecnología y Tienda | Lima, Perú</title>
        <meta name="description" content="Expertos en reparación de smartphones, laptops y tablets. Tienda de tecnología con garantía. Más de 10 años de experiencia en Lima, Perú." />
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
