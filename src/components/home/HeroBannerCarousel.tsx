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

interface CarouselSettings {
  interval_seconds: number | null;
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
          .single<CarouselSettings>(),
      ]);
      if (bannersRes.data && bannersRes.data.length > 0) {
        setBanners(bannersRes.data as Banner[]);
      }
      if (settingsRes.data) {
        setIntervalSeconds(settingsRes.data.interval_seconds ?? 5);
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
    if (banner.link_url?.trim()) {
      if (banner.link_url.startsWith('/')) {
        navigate(banner.link_url);
        return;
      }

      window.open(banner.link_url, '_self');
      return;
    }

    navigate('/tienda?nombre=Promos');
  };

  return (
    <div className="relative mx-auto w-full max-w-[1920px]">
      <div className="relative aspect-[16/5] w-full overflow-hidden bg-[hsl(var(--primary))] sm:rounded-[28px]">
          {banners.map((banner, i) => (
            <div
              key={banner.id}
              className={cn(
                'absolute inset-0 cursor-pointer transition-opacity duration-700 ease-in-out',
                i === current ? 'opacity-100 z-10' : 'opacity-0 z-0'
              )}
              onClick={() => handleBannerClick(banner)}
              role="link"
              tabIndex={i === current ? 0 : -1}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleBannerClick(banner);
              }}
            >
              <img
                src={banner.image_url}
                alt={banner.alt_text || 'Banner promocional'}
                className="h-full w-full object-cover object-center"
                draggable={false}
              />
              <div className="absolute inset-0 bg-gradient-to-r from-slate-950/35 via-transparent to-slate-950/45" />
              <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950/45 to-transparent sm:h-32" />
            </div>
          ))}

          {/* Navigation arrows */}
          {banners.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); goPrev(); }}
                className="absolute bottom-3 left-3 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/25 text-white backdrop-blur-md transition-colors hover:bg-black/45 sm:bottom-auto sm:left-5 sm:top-1/2 sm:h-11 sm:w-11 sm:-translate-y-1/2 lg:left-6"
                aria-label="Banner anterior"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); goNext(); }}
                className="absolute bottom-3 right-3 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/25 text-white backdrop-blur-md transition-colors hover:bg-black/45 sm:bottom-auto sm:right-5 sm:top-1/2 sm:h-11 sm:w-11 sm:-translate-y-1/2 lg:right-6"
                aria-label="Banner siguiente"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}

      </div>
    </div>
  );
};
