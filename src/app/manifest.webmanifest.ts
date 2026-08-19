import type { MetadataRoute } from 'next'
import { publicEnv } from '@/lib/env'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: publicEnv.NEXT_PUBLIC_APP_NAME,
    short_name: 'Goliath Dispatch',
    description:
      'Heavy-haul dispatch software: carrier onboarding and compliance, dispatch, tracking, permits and escorts, and settlements.',
    start_url: '/en/home',
    display: 'standalone',
    background_color: '#062B5C',
    theme_color: '#062B5C',
    icons: [
      {
        src: '/brand/mark.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  }
}
