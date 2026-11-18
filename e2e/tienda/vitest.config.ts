import { defineConfig } from 'vitest/config';
import unitConfig from '../../vitest.config';

export default defineConfig({ ...unitConfig, envDir: false });
