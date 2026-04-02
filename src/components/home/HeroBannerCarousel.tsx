import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface Banner {
  id: string;
  image_url: string;
  link_url: string | null;
  alt_text: string;
  sort_order: number;
}

export const HeroBannerCarousel = () => {
  const navigate = useNavigate();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [intervalSeconds, setIntervalSeconds] = useState(5);

  useEffect(() => {
    const fetchData = async () => {
      const [bannersRes, settingsRes] = await Promise.all([
        supabase
          .from('hero_banners')
          .select('id, image_url, link_url, alt_text, sort_order')
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
        supabase
          .from('carousel_settings')
          .select('interval_seconds')
          .eq('id', 1)
          .single(),
      ]);
      if (bannersRes.data && bannersRes.data.length > 0) {
        setBanners(bannersRes.data as Banner[]);
      }
      if (settingsRes.data) {
        setIntervalSeconds((settingsRes.data as any).interval_seconds ?? 5);
      }
      setLoading(false);
    };
    fetchData();
  }, []);

  // Auto-advance based on configured interval
  useEffect(() => {
    if (banners.length <= 1) return;
    const interval = setInterval(() => {
      setCurrent(prev => (prev + 1) % banners.length);
    }, intervalSeconds * 1000);
    return () => clearInterval(interval);
  }, [banners.length, intervalSeconds]);

  const goTo = useCallback((index: number) => {
    setCurrent(index);
  }, []);

  const goPrev = useCallback(() => {
    setCurrent(prev => (prev - 1 + banners.length) % banners.length);
  }, [banners.length]);

  const goNext = useCallback(() => {
    setCurrent(prev => (prev + 1) % banners.length);
  }, [banners.length]);

  if (loading || banners.length === 0) return null;

  const handleBannerClick = (banner: Banner) => {
    if (banner.link_url) {
      // Si es una URL interna (empieza con /), navegar con el router
      if (banner.link_url.startsWith('/')) {
        navigate(banner.link_url);
      } else {
        window.open(banner.link_url, '_blank', 'noopener,noreferrer');
      }
    } else {
      // Por defecto, llevar a promos en la tienda
      navigate('/tienda?nombre=Promos');
    }
  };

  return (
    <div className="relative w-full overflow-hidden bg-secondary">
      {/*
        Aspect ratio único: 16/5 (3.2:1) — ideal para banners de 1920x600px.
        Se adapta a cualquier ancho de pantalla sin saltos entre breakpoints.
        max-h limita la altura en pantallas muy grandes.
      */}
      <div className="relative w-full" style={{ aspectRatio: '16 / 5', maxHeight: '540px' }}>
        {banners.map((banner, i) => (
          <div
            key={banner.id}
            className={cn(
              'absolute inset-0 transition-opacity duration-700 ease-in-out cursor-pointer',
              i === current ? 'opacity-100 z-10' : 'opacity-0 z-0'
            )}
            onClick={() => handleBannerClick(banner)}
            role="link"
            tabIndex={i === current ? 0 : -1}
            onKeyDown={(e) => { if (e.key === 'Enter') handleBannerClick(banner); }}
          >
            <img
              src={banner.image_url}
              alt={banner.alt_text || 'Banner promocional'}
              className="h-full w-full object-cover object-center"
              draggable={false}
            />
          </div>
        ))}

        {/* Navigation arrows */}
        {banners.length > 1 && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); goPrev(); }}
              className="absolute left-3 sm:left-5 top-1/2 -translate-y-1/2 z-20 flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm hover:bg-black/50 transition-colors"
              aria-label="Banner anterior"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); goNext(); }}
              className="absolute right-3 sm:right-5 top-1/2 -translate-y-1/2 z-20 flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm hover:bg-black/50 transition-colors"
              aria-label="Banner siguiente"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}

        {/* Dots indicator */}
        {banners.length > 1 && (
          <div className="absolute bottom-3 sm:bottom-5 left-1/2 -translate-x-1/2 z-20 flex gap-2">
            {banners.map((_, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); goTo(i); }}
                className={cn(
                  'h-2.5 rounded-full transition-all duration-300',
                  i === current ? 'w-8 bg-white' : 'w-2.5 bg-white/50 hover:bg-white/70'
                )}
                aria-label={`Ir a banner ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
