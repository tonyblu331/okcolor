import { describe, it, expect } from 'vitest'
import { transformCss, auditCss, convertColor, colorToOklch } from '../src/wasm.js'

describe('JS engine core', () => {
  it('transforms hex red to oklch', () => {
    const out = transformCss('color: #ff0000;')
    expect(out).toContain('oklch(')
    expect(out).not.toContain('#ff0000')
  })

  it('transforms rgb red to oklch', () => {
    const out = transformCss('color: rgb(255, 0, 0);')
    expect(out).toContain('oklch(')
  })

  it('transforms hsl red to oklch', () => {
    const out = transformCss('color: hsl(0, 100%, 50%);')
    expect(out).toContain('oklch(')
  })

  it('transforms named red to oklch', () => {
    const out = transformCss('color: red;')
    expect(out).toContain('oklch(')
  })

  it('respects /* oklch-ignore */', () => {
    const out = transformCss('color: #ff0000; /* oklch-ignore */')
    expect(out).toContain('#ff0000')
    expect(out).not.toContain('oklch(')
  })

  it('does not audit ignored legacy colors', () => {
    const stats = auditCss('color: #ff0000; /* oklch-ignore */')
    expect(stats.legacy_count).toBe(0)
    expect(stats.hex_count).toBe(0)
  })

  it('preserves custom ignore comments verbatim', () => {
    const out = transformCss('color: #ff0000; /* keep-legacy */', 'keep-legacy')
    expect(out).toBe('color: #ff0000; /* keep-legacy */')
  })

  it('does not rewrite unrelated oklch-ignore text when custom ignore is configured', () => {
    const out = transformCss(
      '.a { color: #ff0000; /* keep-legacy */ }\n.b::before { color: #00ff00; content: "OKLCH-IGNORE"; }',
      'keep-legacy',
    )
    expect(out).toContain('/* keep-legacy */')
    expect(out).toContain('#ff0000')
    expect(out).not.toContain('#00ff00')
    expect(out).toContain('content: "OKLCH-IGNORE"')
    expect(out).not.toContain('content: "keep-legacy"')
  })

  it('supports custom ignore comments that contain oklch-ignore', () => {
    const out = transformCss(
      '.a { color: #ff0000; /* my-oklch-ignore */ }\n.b { color: #00ff00; }',
      'my-oklch-ignore',
    )
    expect(out).toContain('#ff0000')
    expect(out).toContain('/* my-oklch-ignore */')
    expect(out).not.toContain('#00ff00')
  })

  it('passes through var()', () => {
    const out = transformCss('color: var(--primary);')
    expect(out).toContain('var(--primary)')
    expect(out).not.toContain('oklch(')
  })

  it('passes through currentColor', () => {
    const out = transformCss('border-color: currentColor;')
    expect(out).toContain('currentColor')
    expect(out).not.toContain('oklch(')
  })

  it('passes through calc()', () => {
    const out = transformCss('width: calc(100% - 20px);')
    expect(out).toContain('calc(100% - 20px)')
  })

  it('passes through modern color functions', () => {
    const css = '.a { color: color-mix(in srgb, red, blue); background: light-dark(red, blue); }'
    const out = transformCss(css)
    expect(out).toBe(css)

    const stats = auditCss(css)
    expect(stats.legacy_count).toBe(0)
  })

  it('passes through relative color syntax without rewriting source colors', () => {
    const css = '.a { color: rgb(from red r g b); background: hsl(from blue h s l); border-color: color(from red srgb r g b); }'
    const out = transformCss(css)
    expect(out).toBe(css)

    const stats = auditCss(css)
    expect(stats.legacy_count).toBe(0)
  })

  it('does not transform hex inside strings', () => {
    const out = transformCss('content: "#ff0000";')
    expect(out).toContain('#ff0000')
    expect(out).not.toContain('oklch(')
  })

  it('does not transform id selectors', () => {
    const out = transformCss('#main { color: red; }')
    expect(out).toContain('#main')
    expect(out).toContain('oklch(')
  })

  it('does not transform hex-looking selector prefixes', () => {
    const css = '#abcxyz { color: #fff; }'
    const out = transformCss(css)
    expect(out).toContain('#abcxyz')
    expect(out).not.toContain('oklch(' + 'xyz')

    const stats = auditCss(css)
    expect(stats.hex_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('does not treat oklch-ignore inside strings as an ignore pragma', () => {
    const css = '.a { content: "oklch-ignore"; color: #ff0000; }'
    const out = transformCss(css)
    expect(out).toContain('content: "oklch-ignore"')
    expect(out).not.toContain('#ff0000')

    const stats = auditCss(css)
    expect(stats.hex_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('preserves non-ascii text while transforming colors', () => {
    const out = transformCss('.café::before { content: "mañana"; color: red; }')
    expect(out).toContain('.café::before')
    expect(out).toContain('content: "mañana"')
    expect(out).not.toContain('color: red')
  })

  it('skips url() contents without treating URL slashes or names as colors', () => {
    const css = '.a { background: url(https://cdn.example/red.png); border-image: url(//cdn.example/blue.svg); color: red; }'
    const out = transformCss(css)
    expect(out).toContain('url(https://cdn.example/red.png)')
    expect(out).toContain('url(//cdn.example/blue.svg)')
    expect(out).not.toContain('color: red')

    const stats = auditCss(css)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('does not transform named colors inside identifiers with underscores', () => {
    const css = '.a { animation-name: red_fade; color: red; }'
    const out = transformCss(css)
    expect(out).toContain('red_fade')
    expect(out).not.toContain('color: red')

    const stats = auditCss(css)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('does not transform selector colors inside functional selectors', () => {
    const css = ':is(#abc, .red, .blue) { color: red; }'
    const out = transformCss(css)
    expect(out).toContain(':is(#abc, .red, .blue)')
    expect(out).not.toContain('{ color: red')

    const stats = auditCss(css)
    expect(stats.hex_count).toBe(0)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('does not scan functional pseudo-class type selectors as raw declarations', () => {
    const css = ':is(a:hover), :is(a:focus), :is(button:hover) { color: red; }'
    const out = transformCss(css)
    expect(out).toContain(':is(a:hover), :is(a:focus), :is(button:hover)')
    expect(out).not.toContain('{ color: red')

    const stats = auditCss(css)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('does not repeatedly classify top-level functional selector groups as raw declarations', () => {
    const css = ':not(.x1) a:hover #abc, :not(.x2) a:hover #def, :not(.x3) a:hover #123 { color: red; }'
    const out = transformCss(css)
    expect(out).toContain(':not(.x1) a:hover #abc')
    expect(out).toContain(':not(.x2) a:hover #def')
    expect(out).toContain(':not(.x3) a:hover #123')
    expect(out).not.toContain('color: red')

    const stats = auditCss(css)
    expect(stats.hex_count).toBe(0)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('does not treat pseudo-class selectors as declarations', () => {
    const css = 'a:hover, .red { color: blue; }'
    const out = transformCss(css)
    expect(out).toContain('a:hover, .red')
    expect(out).not.toContain('{ color: blue')

    const stats = auditCss(css)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('does not treat pseudo-class selectors inside grouping at-rules as declarations', () => {
    const css = '@media (min-width: 40rem) { a:hover, .red { color: blue; } }'
    const out = transformCss(css)
    expect(out).toContain('a:hover, .red')
    expect(out).not.toContain('{ color: blue')

    const stats = auditCss(css)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('supports vendor-prefixed declaration properties', () => {
    const css = '.a { -webkit-text-fill-color: red; }'
    const out = transformCss(css)
    expect(out).not.toContain('red')

    const stats = auditCss(css)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('supports custom property declarations with underscore and non-ascii names', () => {
    const css = '.a { --_brand: red; --é: #fff; color: var(--_brand); }'
    const out = transformCss(css)
    expect(out).not.toContain('--_brand: red')
    expect(out).not.toContain('--é: #fff')
    expect(out).toContain('color: var(--_brand)')

    const stats = auditCss(css)
    expect(stats.named_count).toBe(1)
    expect(stats.hex_count).toBe(1)
    expect(stats.legacy_count).toBe(2)
  })

  it('supports custom property declarations with escaped names', () => {
    const css = '.a { --\\31 brand: red; color: var(--\\31 brand); }'
    const out = transformCss(css)
    expect(out).not.toContain('--\\31 brand: red')
    expect(out).toContain('color: var(--\\31 brand)')

    const stats = auditCss(css)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('supports declaration-like at-rule conditions', () => {
    const css = '@supports not (color: #ff0000) { .a { color: red; } } @container style(color: blue) { .b { color: green; } }'
    const out = transformCss(css)
    expect(out).not.toContain('#ff0000')
    expect(out).not.toContain('color: red')
    expect(out).not.toContain('color: blue')
    expect(out).not.toContain('color: green')

    const stats = auditCss(css)
    expect(stats.hex_count).toBe(1)
    expect(stats.named_count).toBe(3)
    expect(stats.legacy_count).toBe(4)
  })

  it('keeps at-rule declaration context through nested value functions', () => {
    const css = '@supports (background: image-set(url(x.png) 1x) red) { .a { color: green; } }'
    const out = transformCss(css)
    expect(out).not.toContain(' red)')
    expect(out).not.toContain('color: green')
    expect(out).toContain('url(x.png)')

    const stats = auditCss(css)
    expect(stats.named_count).toBe(2)
    expect(stats.legacy_count).toBe(2)
  })

  it('does not leak at-rule condition value context into selector conditions', () => {
    const css = '@supports (color: red) and selector(.blue) { .a { color: green; } }'
    const out = transformCss(css)
    expect(out).toContain('selector(.blue)')
    expect(out).not.toContain('color: red')
    expect(out).not.toContain('color: green')

    const stats = auditCss(css)
    expect(stats.named_count).toBe(2)
    expect(stats.legacy_count).toBe(2)
  })

  it('does not scan @supports selector() arguments as declaration values', () => {
    const css = '@supports selector(a:hover, .blue) { .a { color: green; } }'
    const out = transformCss(css)
    expect(out).toContain('selector(a:hover, .blue)')
    expect(out).not.toContain('color: green')

    const stats = auditCss(css)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('does not scan nested @supports selector() functions as declaration values', () => {
    const css = '@supports selector(:is(a:hover #abc, .blue)) { .a { color: green; } }'
    const out = transformCss(css)
    expect(out).toContain('selector(:is(a:hover #abc, .blue))')
    expect(out).not.toContain('color: green')

    const stats = auditCss(css)
    expect(stats.hex_count).toBe(0)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('keeps generated @supports selector() pseudo-class lists out of value scanning', () => {
    const selectors = Array.from(
      { length: 64 },
      (_, index) => `:is(a:hover #abc${index}, button:focus .blue${index})`,
    ).join(', ')
    const css = `@supports selector(${selectors}) { .a { color: green; } }`
    const out = transformCss(css)
    expect(out).toContain(`selector(${selectors})`)
    expect(out).not.toContain('color: green')

    const stats = auditCss(css)
    expect(stats.hex_count).toBe(0)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('does not rewrite identifier-only named property values as colors', () => {
    const css = '.a { animation-name: red; font-family: blue; grid-area: red; view-transition-name: blue; color: red; }'
    const out = transformCss(css)
    expect(out).toContain('animation-name: red')
    expect(out).toContain('font-family: blue')
    expect(out).toContain('grid-area: red')
    expect(out).toContain('view-transition-name: blue')
    expect(out).not.toContain('color: red')

    const stats = auditCss(css)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('does not rewrite additional custom-ident property values as colors', () => {
    const css = '.a { container: red / inline-size; scroll-timeline: blue block; view-timeline-name: red; font-palette: blue; counter-reset: red 0; color: red; }'
    const out = transformCss(css)
    expect(out).toContain('container: red / inline-size')
    expect(out).toContain('scroll-timeline: blue block')
    expect(out).toContain('view-timeline-name: red')
    expect(out).toContain('font-palette: blue')
    expect(out).toContain('counter-reset: red 0')
    expect(out).not.toContain('color: red')

    const stats = auditCss(css)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('supports logical border and text-stroke shorthands with named colors', () => {
    const css = '.a { border-block-start: 1px solid red; border-inline-end: 1px solid blue; -webkit-text-stroke: 1px red; -webkit-text-emphasis: filled blue; }'
    const out = transformCss(css)
    expect(out).not.toContain(' solid red')
    expect(out).not.toContain(' solid blue')
    expect(out).not.toContain('1px red')
    expect(out).not.toContain('filled blue')

    const stats = auditCss(css)
    expect(stats.named_count).toBe(4)
    expect(stats.legacy_count).toBe(4)
  })

  it('supports nested grouping at-rules inside declaration blocks', () => {
    const css = '.foo { @media (min-width: 40rem) { color: blue; background: #fff; } }'
    const out = transformCss(css)
    expect(out).not.toContain('color: blue')
    expect(out).not.toContain('#fff')

    const stats = auditCss(css)
    expect(stats.named_count).toBe(1)
    expect(stats.hex_count).toBe(1)
    expect(stats.legacy_count).toBe(2)
  })

  it('supports declaration-list at-rules with descriptor colors', () => {
    const css = '@font-palette-values --brand { override-colors: 0 red; }'
    const out = transformCss(css)
    expect(out).not.toContain(' red')

    const stats = auditCss(css)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('supports @property color registrations without rewriting non-color initial values', () => {
    const css =
      '@property --brand { initial-value: red; syntax: "<color>"; inherits: false; } ' +
      '@property --token { syntax: "<custom-ident>"; initial-value: blue; inherits: false; }'
    const out = transformCss(css)
    expect(out).not.toContain('initial-value: red')
    expect(out).toContain('initial-value: blue')

    const stats = auditCss(css)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('supports page margin at-rules nested under @page', () => {
    const css = '@page { @top-left { color: red; } }'
    const out = transformCss(css)
    expect(out).not.toContain('color: red')

    const stats = auditCss(css)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('does not transform selectors in nested rule preludes inside declaration blocks', () => {
    const css = '.foo { a:hover #abc .child { color: red; } }'
    const out = transformCss(css)
    expect(out).toContain('a:hover #abc .child')
    expect(out).not.toContain('color: red')

    const stats = auditCss(css)
    expect(stats.hex_count).toBe(0)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('keeps value context across comments containing punctuation', () => {
    const css = '.a { color: /* ; */ red; background: /* ; */ #fff; }'
    const out = transformCss(css)
    expect(out).not.toContain(' red')
    expect(out).not.toContain('#fff')

    const stats = auditCss(css)
    expect(stats.named_count).toBe(1)
    expect(stats.hex_count).toBe(1)
    expect(stats.legacy_count).toBe(2)
  })

  it('does not treat oklch-ignore inside urls as an ignore pragma', () => {
    const css = '.a { background: url(https://cdn.example/oklch-ignore.svg); color: #ff0000; }'
    const out = transformCss(css)
    expect(out).toContain('url(https://cdn.example/oklch-ignore.svg)')
    expect(out).not.toContain('#ff0000')

    const stats = auditCss(css)
    expect(stats.hex_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('audits css correctly', () => {
    const stats = auditCss('color: #ff0000; background: rgb(0, 255, 0);')
    expect(stats.legacy_count).toBe(2)
    expect(stats.hex_count).toBe(1)
    expect(stats.rgb_count).toBe(1)
  })

  it('transforms gradient colors and injects in oklch', () => {
    const out = transformCss('background: linear-gradient(to right, #ff0000, #00ff00);')
    expect(out).toContain('linear-gradient(in oklch, to right,')
    expect(out).toContain('oklch(')
    expect(out).not.toContain('#ff0000')
  })

  it('transforms uppercase CSS color functions and gradients', () => {
    const out = transformCss('color: RGB(255, 0, 0); background: LINEAR-GRADIENT(RED, BLUE);')
    expect(out).toContain('color: oklch(')
    expect(out).toContain('LINEAR-GRADIENT(in oklch,')
    expect(out).not.toContain('RGB(')
    expect(out).not.toContain('RED')

    const stats = auditCss('color: RGB(255, 0, 0); background: LINEAR-GRADIENT(RED, BLUE);')
    expect(stats.rgb_count).toBe(1)
    expect(stats.named_count).toBe(2)
    expect(stats.gradient_count).toBe(1)
  })

  it('ignores an entire line when the oklch-ignore marker is inside the leading comment', () => {
    const ignored = '/* oklch-ignore */ a { color: #ff0000; }'
    const out = transformCss(`${ignored}\nb { color: #00ff00; }`)
    expect(out.split('\n')[0]).toBe(ignored)
    expect(out.match(/#ff0000/g)).toHaveLength(1)
    expect(out).not.toContain('#00ff00')
  })

  it('audits gradients with the same skip rules used by transform', () => {
    const stats = auditCss('background: linear-gradient(var(--red), "blue", /* red */ blue);')
    expect(stats.gradient_count).toBe(1)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('respects oklch-ignore lines inside multiline gradients', () => {
    const css = `background: linear-gradient(
  /* oklch-ignore */ #ff0000,
  #00ff00
);`
    const out = transformCss(css)
    expect(out).toContain('/* oklch-ignore */ #ff0000')
    expect(out.match(/#ff0000/g)).toHaveLength(1)
    expect(out).not.toContain('#00ff00')

    const stats = auditCss(css)
    expect(stats.hex_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('does not inject interpolation for gradients whose only legacy colors are ignored', () => {
    const css = `background: linear-gradient(
  /* oklch-ignore */ #ff0000
);`
    const out = transformCss(css)
    expect(out).toBe(css)

    const stats = auditCss(css)
    expect(stats.gradient_count).toBe(0)
    expect(stats.hex_count).toBe(0)
    expect(stats.legacy_count).toBe(0)
  })

  it('skips line comments inside multiline gradients for transform and audit', () => {
    const css = `background: linear-gradient(
  // red
  blue
);`
    const out = transformCss(css)
    expect(out).toContain('// red')
    expect(out).not.toContain('// oklch')
    expect(out).not.toContain('\n  blue\n')

    const stats = auditCss(css)
    expect(stats.gradient_count).toBe(1)
    expect(stats.named_count).toBe(1)
    expect(stats.legacy_count).toBe(1)
  })

  it('ignores parentheses inside gradient line comments when finding the gradient close', () => {
    const css = `background: linear-gradient(
  // ) red
  blue
);
.after { color: red; }`
    const out = transformCss(css)
    expect(out).toContain('// ) red')
    expect(out).toContain('linear-gradient(in oklch,')
    expect(out).not.toContain('\n  blue\n')
    expect(out).not.toContain('color: red')

    const stats = auditCss(css)
    expect(stats.gradient_count).toBe(1)
    expect(stats.named_count).toBe(2)
    expect(stats.legacy_count).toBe(2)
  })

  it('preserves existing gradient interpolation hint', () => {
    const out = transformCss('background: linear-gradient(in oklab, #ff0000, blue);')
    expect(out).toContain('linear-gradient(in oklab,')
    expect(out).not.toContain('in oklch')
  })

  it('preserves existing non-oklab gradient interpolation hints', () => {
    const out = transformCss('background: linear-gradient(in srgb, red, blue);')
    expect(out).toContain('linear-gradient(in srgb,')
    expect(out).not.toContain('linear-gradient(in oklch, in srgb')
    expect(out).not.toContain('red')
    expect(out).not.toContain('blue')
  })

  it('preserves existing gradient interpolation hints after leading comments', () => {
    const out = transformCss('background: linear-gradient(/* keep */ in srgb, red, blue);')
    expect(out).toContain('linear-gradient(/* keep */ in srgb,')
    expect(out).not.toContain('linear-gradient(in oklch, /* keep */ in srgb')
    expect(out).not.toContain('red')
    expect(out).not.toContain('blue')
  })

  it('preserves gradient interpolation hints after angle or comments', () => {
    const angled = transformCss('background: linear-gradient(90deg in srgb, red, blue);')
    expect(angled).toContain('linear-gradient(90deg in srgb,')
    expect(angled).not.toContain('linear-gradient(in oklch, 90deg in srgb')
    expect(angled).not.toContain('red')
    expect(angled).not.toContain('blue')

    const commented = transformCss('background: linear-gradient(in/**/srgb, red, blue);')
    expect(commented).toContain('linear-gradient(in/**/srgb,')
    expect(commented).not.toContain('linear-gradient(in oklch, in/**/srgb')
    expect(commented).not.toContain('red')
    expect(commented).not.toContain('blue')
  })

  it('does not treat nested modern function interpolation as gradient interpolation', () => {
    const out = transformCss('background: linear-gradient(color-mix(in srgb, red, blue), green);')
    expect(out).toContain('linear-gradient(in oklch, color-mix(in srgb, red, blue),')
    expect(out).not.toContain(', green)')
  })

  it('does not treat line-comment interpolation text as gradient interpolation', () => {
    const css = `background: linear-gradient(
  // in srgb
  red,
  blue
);`
    const out = transformCss(css)
    expect(out).toContain('linear-gradient(in oklch,')
    expect(out).toContain('// in srgb')
    expect(out).not.toContain('\n  red,')
    expect(out).not.toContain('\n  blue\n')
  })

  it('skips var() inside gradients', () => {
    const out = transformCss('background: linear-gradient(to bottom, var(--start), blue);')
    expect(out).toContain('linear-gradient(in oklch, to bottom,')
    expect(out).toContain('var(--start)')
  })

  it('preserves alpha from rgba', () => {
    const out = transformCss('color: rgba(255, 0, 0, 0.5);')
    expect(out).toContain('oklch(')
    expect(out).toContain('/ 0.5')
  })

  it('preserves alpha from hex8', () => {
    const out = transformCss('color: #ff000080;')
    expect(out).toContain('oklch(')
    expect(out).toContain('/ 0.502')
  })

  it('transforms hwb to oklch', () => {
    const out = transformCss('color: hwb(0 0% 0%);')
    expect(out).toContain('oklch(')
    expect(out).not.toContain('hwb(')
  })

  it('transforms color(srgb) to oklch', () => {
    const out = transformCss('color: color(srgb 1 0 0);')
    expect(out).toContain('oklch(')
    expect(out).not.toContain('color(srgb')
  })

  it('colorToOklch converts hex', () => {
    expect(colorToOklch('#ff0000')).toBe('oklch(62.8% 0.25768 29.23)')
  })

  it('colorToOklch converts named', () => {
    expect(colorToOklch('red')).toBe('oklch(62.8% 0.25768 29.23)')
  })

  it('colorToOklch returns undefined for unknown', () => {
    expect(colorToOklch('not-a-color')).toBeUndefined()
  })

  it('convertColor converts hex to hsl', () => {
    expect(convertColor('#ff0000', 'hsl')).toBe('hsl(0 100% 50%)')
  })

  it('convertColor converts hex to hex', () => {
    expect(convertColor('#ff0000', 'hex')).toBe('#ff0000')
  })

  it('convertColor converts hex to rgb', () => {
    expect(convertColor('#ff0000', 'rgb')).toBe('rgb(255 0 0)')
  })

  it('convertColor converts hsl to hex', () => {
    expect(convertColor('hsl(0 100% 50%)', 'hex')).toBe('#ff0000')
  })

  it('convertColor converts named to hwb', () => {
    expect(convertColor('red', 'hwb')).toBe('hwb(0 0% 0%)')
  })

  it('convertColor converts oklch to hex', () => {
    expect(convertColor('oklch(62.796% 0.25768 29.2339)', 'hex')).toBe('#ff0000')
  })

  it('convertColor converts oklch to hsl', () => {
    expect(convertColor('oklch(62.796% 0.25768 29.2339)', 'hsl')).toBe('hsl(0 100% 50%)')
  })

  it('convertColor converts oklch to oklch', () => {
    expect(convertColor('oklch(62.796% 0.25768 29.2339)', 'oklch')).toBe('oklch(62.8% 0.25768 29.23)')
  })

  it('convertColor returns undefined for unknown', () => {
    expect(convertColor('not-a-color', 'oklch')).toBeUndefined()
  })

  it('passes through oklch()', () => {
    const out = transformCss('color: oklch(62.8% 0.2577 29.23);')
    expect(out).toContain('oklch(62.8% 0.2577 29.23)')
  })

  it('passes through oklab()', () => {
    const out = transformCss('color: oklab(0.628 0.224 0.126);')
    expect(out).toContain('oklab(0.628 0.224 0.126)')
  })

  it('passes through lab()', () => {
    const out = transformCss('color: lab(53.2% 80.1 67.5);')
    expect(out).toContain('lab(53.2% 80.1 67.5)')
  })

  it('passes through lch()', () => {
    const out = transformCss('color: lch(53.2% 105.0 42.6);')
    expect(out).toContain('lch(53.2% 105.0 42.6)')
  })
})
