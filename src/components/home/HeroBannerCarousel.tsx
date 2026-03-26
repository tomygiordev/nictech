import { useState, useEffect, useCallback } from 'react';
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

  const Wrapper = banners[current]?.link_url ? 'a' : 'div';
  const wrapperProps = banners[current]?.link_url
    ? { href: banners[current].link_url!, target: '_blank' as const, rel: 'noopener noreferrer' }
    : {};

  return (
    <div className="relative w-full overflow-hidden bg-secondary">
      <div className="relative aspect-[21/9] sm:aspect-[21/7] md:aspect-[21/6] max-h-[480px] w-full">
        {banners.map((banner, i) => (
          <div
            key={banner.id}
            className={cn(
              'absolute inset-0 transition-opacity duration-700 ease-in-out',
              i === current ? 'opacity-100 z-10' : 'opacity-0 z-0'
            )}
          >
            {banner.link_url ? (
              <a href={banner.link_url} target="_blank" rel="noopener noreferrer" className="block h-full w-full">
                <img
                  src={banner.image_url}
                  alt={banner.alt_text || 'Banner'}
                  className="h-full w-full object-cover"
                />
              </a>
            ) : (
              <img
                src={banner.image_url}
                alt={banner.alt_text || 'Banner'}
                className="h-full w-full object-cover"
              />
            )}
          </div>
        ))}

        {/* Navigation arrows */}
        {banners.length > 1 && (
          <>
            <button
              onClick={goPrev}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm hover:bg-black/50 transition-colors"
              aria-label="Banner anterior"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={goNext}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm hover:bg-black/50 transition-colors"
              aria-label="Banner siguiente"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}

        {/* Dots indicator */}
        {banners.length > 1 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex gap-2">
            {banners.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
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
