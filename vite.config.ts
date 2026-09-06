import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'functions/src/commerce/**/*.test.ts',
      'functions/src/creator-delivery/**/*.test.ts',
      'functions/src/notifications/**/*.test.ts',
      'functions/src/gym-community/**/*.test.ts',
    ],
  },
});
