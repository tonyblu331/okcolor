export function audit_css(input: string): string
export function color_to_oklch(input: string): string | undefined
export function convert_color(input: string, to_space: string): string | undefined
export function expand_oklch_chroma(
  l: number,
  c: number,
  h: number,
  target_gamut: string,
  amount: number,
): string | undefined
export function fit_oklch_gamut(l: number, c: number, h: number, target_gamut: string): string | undefined
export function oklch_chroma_max(l: number, h: number, target_gamut: string): number | undefined
export function oklch_in_gamut(l: number, c: number, h: number, target_gamut: string): boolean | undefined
export function oklch_relative_luminance(l: number, c: number, h: number): number
export function transform_css(input: string): string

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module

export interface InitOutput {
  readonly memory: WebAssembly.Memory
}

export default function init(
  moduleOrPath?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>,
): Promise<InitOutput>
