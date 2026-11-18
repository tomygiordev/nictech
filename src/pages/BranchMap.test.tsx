import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { describe, expect, it, vi } from 'vitest';
import Contacto from './Contacto';
import Servicios from './Servicios';

vi.mock('@/components/layout/Layout', () => ({
  Layout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/home/HeroBannerCarousel', () => ({ HeroBannerCarousel: () => null }));

describe('mapa de la sucursal', () => {
  it.each([['Contacto', Contacto], ['Servicios', Servicios]])('%s embebe el mapa desde el origen permitido por CSP', (_name, Page) => {
    render(<HelmetProvider><Page /></HelmetProvider>);
    const frame = screen.getByTitle('Ubicación Nictech - Urdinarrain') as HTMLIFrameElement;
    const url = new URL(frame.src);
    expect(url.origin).toBe('https://www.google.com');
    expect(url.pathname).toBe('/maps');
    expect(url.searchParams.get('output')).toBe('embed');
    expect(url.searchParams.get('q')).toContain('Héroes de Malvinas 08, Urdinarrain');
  });
});
