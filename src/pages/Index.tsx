import { Helmet } from 'react-helmet-async';
import { Layout } from '@/components/layout/Layout';
import { HeroBannerCarousel } from '@/components/home/HeroBannerCarousel';
import { HeroSection } from '@/components/home/HeroSection';
import { WhyChooseUs } from '@/components/home/WhyChooseUs';
import { OurServices } from '@/components/home/OurServices';

const Index = () => {
  return (
    <>
      <Helmet>
        <title>Nictech - Reparación de Tecnología y Tienda | Entre Ríos, Argentina</title>
        <meta name="description" content="Especialidad en reparación de smartphones, laptops y tablets. Tienda de tecnología con garantía. Compromiso con la excelencia en Urdinarrain, Entre Ríos." />
      </Helmet>
      <Layout>
        <HeroBannerCarousel />
        <HeroSection />
        <WhyChooseUs />
        <OurServices />
      </Layout>
    </>
  );
};

export default Index;
