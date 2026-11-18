import { defineConfig } from 'vite';
import storefrontConfig from '../../vite.config';

export default defineConfig((env) => {
  const config = storefrontConfig(env);
  return {
    ...config,
    envDir: false,
    build: { ...config.build, outDir: 'e2e/tienda/dist' },
  };
});
