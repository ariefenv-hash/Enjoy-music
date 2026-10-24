/** 内联 SVG 图标（Material Symbols 风格，离线可用） */
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 20, ...rest }: P): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'currentColor',
    ...rest,
  }
}

export const IconPlay = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 5.14v14l11-7-11-7z" />
  </svg>
)
export const IconPause = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
)
export const IconPrev = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 6h2v12H7V6zm3.5 6 8.5 6V6l-8.5 6z" />
  </svg>
)
export const IconNext = (p: P) => (
  <svg {...base(p)}>
    <path d="M15 6h2v12h-2V6zM5 18l8.5-6L5 6v12z" />
  </svg>
)
export const IconUpload = (p: P) => (
  <svg {...base(p)}>
    <path d="M11 16V8.83L8.41 11.4 7 10l5-5 5 5-1.41 1.4L13 8.83V16h-2zM5 20v-4h2v2h10v-2h2v4H5z" />
  </svg>
)
export const IconLyrics = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 4h16v2H4V4zm0 5h16v2H4V9zm0 5h10v2H4v-2zm0 5h7v2H4v-2zm13.5-1.5a2 2 0 1 1-2-2c.35 0 .69.07 1 .21V9.5l4-1v2l-3 .75v5.25z" />
  </svg>
)
export const IconSettings = (p: P) => (
  <svg {...base(p)}>
    <path d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.43h-3.84a.5.5 0 0 0-.5.43l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.65 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.61.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.04.24.25.43.5.43h3.84c.25 0 .46-.19.5-.43l.36-2.54c.59-.24 1.12-.56 1.62-.94l2.39.96c.22.1.48 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" />
  </svg>
)
export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
  </svg>
)
export const IconVolume = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z" />
  </svg>
)
export const IconDownload = (p: P) => (
  <svg {...base(p)}>
    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
  </svg>
)
export const IconEdit = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
  </svg>
)
export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
  </svg>
)
export const IconSun = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM11 1h2v3h-2V1zm0 19h2v3h-2v-3zM3.51 4.93 4.93 3.5l2.12 2.12-1.41 1.41L3.51 4.93zm13.44 13.45 1.41-1.41 2.12 2.12-1.41 1.41-2.12-2.12zM2 11h3v2H2v-2zm17 0h3v2h-3v-2zM3.51 19.07l2.12-2.12 1.41 1.41-2.12 2.12-1.41-1.41zM16.95 5.62l2.12-2.12 1.41 1.42-2.12 2.12-1.41-1.42z" />
  </svg>
)
export const IconMoon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12.3 2a10 10 0 1 0 9.7 12.3A8 8 0 0 1 12.3 2z" />
  </svg>
)
export const IconMusic = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
  </svg>
)
export const IconBolt = (p: P) => (
  <svg {...base(p)}>
    <path d="M11 21h-1l1-7H7.5c-.88 0-.33-.75-.31-.78C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.4 0 .62.19.4.66C12.97 17.55 11 21 11 21z" />
  </svg>
)
export const IconSpark = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 2l1.8 5.7L19.5 9l-5.7 1.8L12 16.5l-1.8-5.7L4.5 9l5.7-1.3L12 2zm6 12 .9 2.6 2.6.9-2.6.9L18 21l-.9-2.6-2.6-.9 2.6-.9.9-2.6z" />
  </svg>
)
export const IconMic = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
  </svg>
)
export const IconRefresh = (p: P) => (
  <svg {...base(p)}>
    <path d="M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
  </svg>
)
export const IconWarn = (p: P) => (
  <svg {...base(p)}>
    <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
  </svg>
)
export const IconSpeed = (p: P) => (
  <svg {...base(p)}>
    <path d="M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.27-10.44zm-9.79 6.84a2 2 0 0 0 2.83 0l5.66-8.49-8.49 5.66a2 2 0 0 0 0 2.83z" />
  </svg>
)
