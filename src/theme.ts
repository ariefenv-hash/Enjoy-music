/**
 * MD3 主题系统：种子色 → 明/暗两套设计令牌，运行时写入 CSS 变量。
 * 色值参考 Material Design 3 官方 baseline 及 HCT 调色板典型输出。
 * 壁纸动态配色使用官方 material-color-utilities（HCT / Material You 同源算法）。
 */
import {
  QuantizerCelebi,
  Score,
  Hct,
  argbFromHex,
  hexFromArgb,
  themeFromSourceColor,
} from '@material/material-color-utilities'

export type SeedId = 'violet' | 'ocean' | 'forest' | 'sunset' | 'amber'
export type ThemeMode = 'light' | 'dark'

export interface Md3Palette {
  label: string
  light: Record<string, string>
  dark: Record<string, string>
}

const VIOLET_L = {
  primary: '#6750A4', onPrimary: '#FFFFFF', primaryContainer: '#EADDFF', onPrimaryContainer: '#21005D',
  secondary: '#625B71', secondaryContainer: '#E8DEF8', onSecondaryContainer: '#1D192B',
  tertiary: '#7D5260', tertiaryContainer: '#FFD8E4', onTertiaryContainer: '#31111D',
  surface: '#FEF7FF', surfaceDim: '#DED8E1', surfaceBright: '#FEF7FF',
  surfaceContainerLowest: '#FFFFFF', surfaceContainerLow: '#F7F2FA', surfaceContainer: '#F3EDF7',
  surfaceContainerHigh: '#ECE6F0', surfaceContainerHighest: '#E6E0E9',
  onSurface: '#1D1B20', onSurfaceVariant: '#49454F', outline: '#79747E', outlineVariant: '#CAC4D0',
  inverseSurface: '#322F35', inverseOnSurface: '#F5EFF7', inversePrimary: '#D0BCFF',
  error: '#BA1A1A', errorContainer: '#FFDAD6', onErrorContainer: '#410002',
  scrim: '#000000', shadow: '#000000',
}
const VIOLET_D = {
  primary: '#D0BCFF', onPrimary: '#381E72', primaryContainer: '#4F378B', onPrimaryContainer: '#EADDFF',
  secondary: '#CCC2DC', secondaryContainer: '#4A4458', onSecondaryContainer: '#E8DEF8',
  tertiary: '#EFB8C8', tertiaryContainer: '#633B48', onTertiaryContainer: '#FFD8E4',
  surface: '#141218', surfaceDim: '#141218', surfaceBright: '#3B383E',
  surfaceContainerLowest: '#0F0D13', surfaceContainerLow: '#1D1B20', surfaceContainer: '#211F26',
  surfaceContainerHigh: '#2B2930', surfaceContainerHighest: '#36343B',
  onSurface: '#E6E0E9', onSurfaceVariant: '#CAC4D0', outline: '#938F99', outlineVariant: '#49454F',
  inverseSurface: '#E6E0E9', inverseOnSurface: '#322F35', inversePrimary: '#6750A4',
  error: '#FFB4AB', errorContainer: '#93000A', onErrorContainer: '#FFDAD6',
  scrim: '#000000', shadow: '#000000',
}
const OCEAN_L = {
  primary: '#0061A4', onPrimary: '#FFFFFF', primaryContainer: '#D1E4FF', onPrimaryContainer: '#001D36',
  secondary: '#535F70', secondaryContainer: '#D7E3F7', onSecondaryContainer: '#101C2B',
  tertiary: '#6B5778', tertiaryContainer: '#F2DAFF', onTertiaryContainer: '#251431',
  surface: '#F8F9FF', surfaceDim: '#D8DAE0', surfaceBright: '#F8F9FF',
  surfaceContainerLowest: '#FFFFFF', surfaceContainerLow: '#F2F3FA', surfaceContainer: '#ECEEF4',
  surfaceContainerHigh: '#E6E8EE', surfaceContainerHighest: '#E1E2E8',
  onSurface: '#191C20', onSurfaceVariant: '#44474E', outline: '#74777F', outlineVariant: '#C4C6D0',
  inverseSurface: '#2E3135', inverseOnSurface: '#EFF0F7', inversePrimary: '#A0CAFD',
  error: '#BA1A1A', errorContainer: '#FFDAD6', onErrorContainer: '#410002',
  scrim: '#000000', shadow: '#000000',
}
const OCEAN_D = {
  primary: '#A0CAFD', onPrimary: '#003258', primaryContainer: '#00497D', onPrimaryContainer: '#D1E4FF',
  secondary: '#BBC7DB', secondaryContainer: '#3E4C5C', onSecondaryContainer: '#D7E3F7',
  tertiary: '#D7BDE4', tertiaryContainer: '#523F5F', onTertiaryContainer: '#F2DAFF',
  surface: '#111418', surfaceDim: '#111418', surfaceBright: '#37393E',
  surfaceContainerLowest: '#0C0E12', surfaceContainerLow: '#191C20', surfaceContainer: '#1D2024',
  surfaceContainerHigh: '#282A2F', surfaceContainerHighest: '#33353A',
  onSurface: '#E1E2E8', onSurfaceVariant: '#C4C6D0', outline: '#8E9099', outlineVariant: '#44474E',
  inverseSurface: '#E1E2E8', inverseOnSurface: '#2E3135', inversePrimary: '#0061A4',
  error: '#FFB4AB', errorContainer: '#93000A', onErrorContainer: '#FFDAD6',
  scrim: '#000000', shadow: '#000000',
}
const FOREST_L = {
  primary: '#386A20', onPrimary: '#FFFFFF', primaryContainer: '#B7F397', onPrimaryContainer: '#052100',
  secondary: '#55624C', secondaryContainer: '#D8E7CB', onSecondaryContainer: '#131F0E',
  tertiary: '#386663', tertiaryContainer: '#BCECE7', onTertiaryContainer: '#00201E',
  surface: '#F7FBF1', surfaceDim: '#D7DBD0', surfaceBright: '#F7FBF1',
  surfaceContainerLowest: '#FFFFFF', surfaceContainerLow: '#F1F5EA', surfaceContainer: '#EBEFE5',
  surfaceContainerHigh: '#E5E9DF', surfaceContainerHighest: '#DFE4D9',
  onSurface: '#191D16', onSurfaceVariant: '#43483F', outline: '#73796D', outlineVariant: '#C3C8BB',
  inverseSurface: '#2E322A', inverseOnSurface: '#EFF2E8', inversePrimary: '#9CD67B',
  error: '#BA1A1A', errorContainer: '#FFDAD6', onErrorContainer: '#410002',
  scrim: '#000000', shadow: '#000000',
}
const FOREST_D = {
  primary: '#9CD67B', onPrimary: '#0E3900', primaryContainer: '#1F5209', onPrimaryContainer: '#B7F397',
  secondary: '#BCCBB0', secondaryContainer: '#284A21', onSecondaryContainer: '#D8E7CB',
  tertiary: '#A0D0CB', tertiaryContainer: '#1F4E4B', onTertiaryContainer: '#BCECE7',
  surface: '#10140E', surfaceDim: '#10140E', surfaceBright: '#363A32',
  surfaceContainerLowest: '#0B0F09', surfaceContainerLow: '#191D16', surfaceContainer: '#1D201A',
  surfaceContainerHigh: '#272B24', surfaceContainerHighest: '#32362E',
  onSurface: '#DFE4D9', onSurfaceVariant: '#C3C8BB', outline: '#8D9287', outlineVariant: '#43483F',
  inverseSurface: '#DFE4D9', inverseOnSurface: '#2E322A', inversePrimary: '#386A20',
  error: '#FFB4AB', errorContainer: '#93000A', onErrorContainer: '#FFDAD6',
  scrim: '#000000', shadow: '#000000',
}
const SUNSET_L = {
  primary: '#8E4957', onPrimary: '#FFFFFF', primaryContainer: '#FFD9DE', onPrimaryContainer: '#3A0713',
  secondary: '#75565B', secondaryContainer: '#FFD9DE', onSecondaryContainer: '#2B1518',
  tertiary: '#7C5635', tertiaryContainer: '#FFDCC1', onTertiaryContainer: '#2E1500',
  surface: '#FFF8F7', surfaceDim: '#E8D8D9', surfaceBright: '#FFF8F7',
  surfaceContainerLowest: '#FFFFFF', surfaceContainerLow: '#FFF0F1', surfaceContainer: '#F8E9EA',
  surfaceContainerHigh: '#F2E3E4', surfaceContainerHighest: '#ECDDDE',
  onSurface: '#22191A', onSurfaceVariant: '#524345', outline: '#857374', outlineVariant: '#D8C1C3',
  inverseSurface: '#382E2F', inverseOnSurface: '#FFECEE', inversePrimary: '#FFB1BF',
  error: '#BA1A1A', errorContainer: '#FFDAD6', onErrorContainer: '#410002',
  scrim: '#000000', shadow: '#000000',
}
const SUNSET_D = {
  primary: '#FFB1BF', onPrimary: '#5E1130', primaryContainer: '#733345', onPrimaryContainer: '#FFD9DE',
  secondary: '#E4BDC1', secondaryContainer: '#4C3337', onSecondaryContainer: '#FFD9DE',
  tertiary: '#EDBF94', tertiaryContainer: '#5E4021', onTertiaryContainer: '#FFDCC1',
  surface: '#1A1112', surfaceDim: '#1A1112', surfaceBright: '#423738',
  surfaceContainerLowest: '#140C0D', surfaceContainerLow: '#22191A', surfaceContainer: '#271D1E',
  surfaceContainerHigh: '#322728', surfaceContainerHighest: '#3D3233',
  onSurface: '#ECDDDE', onSurfaceVariant: '#D8C1C3', outline: '#A08C8D', outlineVariant: '#524345',
  inverseSurface: '#ECDDDE', inverseOnSurface: '#382E2F', inversePrimary: '#8E4957',
  error: '#FFB4AB', errorContainer: '#93000A', onErrorContainer: '#FFDAD6',
  scrim: '#000000', shadow: '#000000',
}
const AMBER_L = {
  primary: '#7A5900', onPrimary: '#FFFFFF', primaryContainer: '#FFDEA6', onPrimaryContainer: '#261A00',
  secondary: '#6C5C3F', secondaryContainer: '#F5E0BB', onSecondaryContainer: '#241A04',
  tertiary: '#4B6547', tertiaryContainer: '#CDEBC5', onTertiaryContainer: '#08200F',
  surface: '#FFF8F1', surfaceDim: '#E8D8C6', surfaceBright: '#FFF8F1',
  surfaceContainerLowest: '#FFFFFF', surfaceContainerLow: '#FCF1E1', surfaceContainer: '#F6EBDA',
  surfaceContainerHigh: '#F1E5D4', surfaceContainerHighest: '#EBE0CE',
  onSurface: '#1F1B13', onSurfaceVariant: '#4D4639', outline: '#7F7667', outlineVariant: '#D1C5B4',
  inverseSurface: '#343027', inverseOnSurface: '#F8F0E2', inversePrimary: '#F7BD46',
  error: '#BA1A1A', errorContainer: '#FFDAD6', onErrorContainer: '#410002',
  scrim: '#000000', shadow: '#000000',
}
const AMBER_D = {
  primary: '#F7BD46', onPrimary: '#402D00', primaryContainer: '#5C4300', onPrimaryContainer: '#FFDEA6',
  secondary: '#D9C4A1', secondaryContainer: '#52452A', onSecondaryContainer: '#F5E0BB',
  tertiary: '#B1CCAB', tertiaryContainer: '#334D31', onTertiaryContainer: '#CDEBC5',
  surface: '#17130C', surfaceDim: '#17130C', surfaceBright: '#3E392F',
  surfaceContainerLowest: '#120D07', surfaceContainerLow: '#1F1B13', surfaceContainer: '#241F17',
  surfaceContainerHigh: '#2E2921', surfaceContainerHighest: '#39342B',
  onSurface: '#EBE0CE', onSurfaceVariant: '#D1C5B4', outline: '#99907F', outlineVariant: '#4D4639',
  inverseSurface: '#EBE0CE', inverseOnSurface: '#343027', inversePrimary: '#7A5900',
  error: '#FFB4AB', errorContainer: '#93000A', onErrorContainer: '#FFDAD6',
  scrim: '#000000', shadow: '#000000',
}

export const SEEDS: Record<SeedId, Md3Palette> = {
  violet: { label: '星紫', light: VIOLET_L, dark: VIOLET_D },
  ocean: { label: '海蓝', light: OCEAN_L, dark: OCEAN_D },
  forest: { label: '森绿', light: FOREST_L, dark: FOREST_D },
  sunset: { label: '霞粉', light: SUNSET_L, dark: SUNSET_D },
  amber: { label: '琥珀', light: AMBER_L, dark: AMBER_D },
}

/* ============ 壁纸动态主题：取 3 色 → 混搭成一套 MD3 方案 ============ */

export interface CustomPalette {
  /** 三种子色（hex），来自壁纸色彩分析：主色 / 次色 / 三色，视觉统一 */
  seeds: [string, string, string]
  /** 壁纸缩略图（dataURL，用于设置面板回显，体积 ~5KB） */
  thumb: string
}

const TOKEN_KEYS = [
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer',
  'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
  'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer',
  'surface', 'onSurface', 'onSurfaceVariant', 'outline', 'outlineVariant',
  'inverseSurface', 'inverseOnSurface', 'inversePrimary',
  'error', 'errorContainer', 'onErrorContainer',
] as const

/**
 * Scheme（2021 规范）不含 surfaceContainer* / surfaceDim / surfaceBright，
 * 按官方 M3 tone 规范从中性调色板补齐（缺了会被 hexFromArgb(undefined) 写成 #000000）。
 */
function surfaceTokens(theme: ReturnType<typeof themeFromSourceColor>, mode: 'light' | 'dark'): Record<string, string> {
  const n = theme.palettes.neutral
  const t = (tone: number): string => hexFromArgb(n.tone(tone))
  return mode === 'light'
    ? {
        surfaceDim: t(87), surfaceBright: t(98),
        surfaceContainerLowest: t(100), surfaceContainerLow: t(96), surfaceContainer: t(94),
        surfaceContainerHigh: t(92), surfaceContainerHighest: t(90),
      }
    : {
        surfaceDim: t(6), surfaceBright: t(24),
        surfaceContainerLowest: t(4), surfaceContainerLow: t(10), surfaceContainer: t(12),
        surfaceContainerHigh: t(17), surfaceContainerHighest: t(22),
      }
}

/**
 * 壁纸 → 三色种子：
 *  1. 缩到 ≤128px 采样像素，QuantizerCelebi 量化（Android Material You 同源算法）
 *  2. Score 按 population+saturation+skin 稳定性排序
 *  3. 以色相距离 ≥25° 去重取前 3 个视觉可分的颜色
 *  4. 单色壁纸（如纯色/渐变）用色相偏移合成，保持视觉统一
 */
export async function extractPaletteFromImage(src: Blob): Promise<CustomPalette> {
  const img = await createImageBitmap(src)
  const scale = Math.min(1, 128 / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 不可用')
  ctx.drawImage(img, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)

  const quantized = QuantizerCelebi.quantize(data as unknown as number[], 64)
  const ranked = Score.score(quantized)

  // 色相去重取 3 色
  const picked: number[] = []
  const hueDist = (a: number, b: number): number => {
    const d = Math.abs(a - b) % 360
    return d > 180 ? 360 - d : d
  }
  for (const argb of ranked) {
    if (picked.length >= 3) break
    const hue = Hct.fromInt(argb).hue
    if (picked.every((p) => hueDist(Hct.fromInt(p).hue, hue) >= 25)) picked.push(argb)
  }
  // 单色壁纸：围绕主色相 ±40°/±80° 合成，色相相邻 → 混搭自然统一
  if (picked.length < 3 && ranked.length) {
    const base = Hct.fromInt(ranked[0])
    const chroma = Math.max(24, Math.min(48, base.chroma))
    while (picked.length < 3) {
      const off = picked.length === 1 ? 40 : 80
      const alt = (picked.length % 2 === 1 ? 1 : -1) * off
      picked.push(Hct.from((base.hue + alt + 360) % 360, chroma, Math.max(40, Math.min(60, base.tone))).toInt())
    }
  }
  if (!picked.length) throw new Error('无法从图片中提取颜色')

  // 缩略图（设置面板回显 + 持久化到 localStorage）
  const tw = Math.max(1, Math.round(96 * (img.width / Math.max(img.width, img.height) || 1)))
  const th = Math.max(1, Math.round(96 * (img.height / Math.max(img.width, img.height) || 1)))
  const tc = document.createElement('canvas')
  tc.width = tw
  tc.height = th
  tc.getContext('2d')?.drawImage(img, 0, 0, tw, th)
  const thumb = tc.toDataURL('image/jpeg', 0.72)
  img.close?.()

  const seeds = picked.map((a) => hexFromArgb(a)) as [string, string, string]
  return { seeds, thumb }
}

/**
 * 三色 → 一套完整 MD3 方案（明/暗）：
 *  primary 组 ← 种子1，secondary 组 ← 种子2，tertiary 组 ← 种子3（官方 HCT 调色生成）；
 *  中性面（surface 系/outline/inverse）统一来自种子1 的 neutral 调色板 → 三色混搭且整体和谐。
 */
export function buildCustomPalette(seeds: readonly [string, string, string]): Md3Palette {
  const [t1, t2, t3] = seeds.map((hex) => themeFromSourceColor(argbFromHex(hex)))
  const pick = (theme: typeof t1, mode: 'light' | 'dark', keys: readonly string[]): Record<string, string> => {
    const scheme = theme.schemes[mode]
    const out: Record<string, string> = {}
    for (const k of keys) out[k] = hexFromArgb((scheme as unknown as Record<string, number>)[k])
    return out
  }
  const light: Record<string, string> = {
    ...pick(t1, 'light', TOKEN_KEYS),
    ...surfaceTokens(t1, 'light'),
    ...pick(t2, 'light', ['secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer']),
    ...pick(t3, 'light', ['tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer']),
    scrim: '#000000',
    shadow: '#000000',
  }
  const dark: Record<string, string> = {
    ...pick(t1, 'dark', TOKEN_KEYS),
    ...surfaceTokens(t1, 'dark'),
    ...pick(t2, 'dark', ['secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer']),
    ...pick(t3, 'dark', ['tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer']),
    scrim: '#000000',
    shadow: '#000000',
  }
  return { label: '壁纸配色', light, dark }
}

/** 把指定种子/模式的令牌写入 :root CSS 变量；seed='custom' 时用壁纸分析出的三色方案 */
export function applyTheme(seed: SeedId | 'custom', mode: ThemeMode, custom?: CustomPalette | null): void {
  if (seed === 'custom' && custom) {
    const pal = buildCustomPalette(custom.seeds)
    applyTokens(pal[mode], mode, 'custom')
    return
  }
  const pal = SEEDS[seed as SeedId]?.[mode] ?? VIOLET_D
  applyTokens(pal, mode, seed)
}

/** 令牌写入（camelCase 与 styles/*.css 中的 var(--md-xxxYyy) 命名一致） */
function applyTokens(pal: Record<string, string>, mode: ThemeMode, seed: string): void {
  const el = document.documentElement
  for (const [k, v] of Object.entries(pal)) el.style.setProperty(`--md-${k}`, v)
  el.dataset.mode = mode
  el.dataset.seed = seed
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', pal.surface)
}
