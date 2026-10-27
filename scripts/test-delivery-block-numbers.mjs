import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../delivery_map_mapbox/test/index.html', import.meta.url), 'utf8');
const names = ['blockNumberLayerVisible', 'blockNumberLayerDefinition', 'addBlockNumberLayer',
  'updateBlockNumberButton', 'toggleBlockNumbers', 'setAddressLayerVisibility',
  'toggleAddressBlocks', 'toggleHyphenBanchiLabels'];
function source(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Missing ${name}`);
  const end = html.indexOf('\nfunction ', start + 1);
  return html.slice(start, end);
}

function createContext({ sourceReady = true, rejectSlot = false, rejectLayer = false } = {}) {
  const layers = new Map();
  const values = new Map();
  const errors = [];
  const button = { textContent: '', classList: { toggle() {} }, setAttribute(name, value) { this[name] = value; } };
  const map = {
    getSource: () => sourceReady ? {} : undefined,
    getLayer: id => layers.get(id),
    addLayer(layer) {
      if (rejectLayer || (rejectSlot && layer.slot)) throw new Error('Unsupported layer');
      layers.set(layer.id, structuredClone(layer));
    },
    setLayoutProperty(id, key, value) { layers.get(id).layout[key] = value; }
  };
  const context = vm.createContext({
    addrVisible: true, blockNumberVisible: true, hyphenBanchiVisible: true,
    BLOCK_NUMBER_LAYER_ID: 'block', STREETS_HOUSENUM_SOURCE_ID: 'streets',
    STREETS_HOUSENUM_LAYER_ID: 'house', BANCHI_LAYER_ID: 'hyphen',
    BLOCK_NUMBER_VISIBLE_KEY: 'block-setting', ADDR_VISIBLE_KEY: 'address-setting',
    STREETS_HOUSENUM_VISIBLE_KEY: 'hyphen-setting', BANCHI_DISPLAY_MIN_ZOOM: 16.5,
    $: () => button, map, localStorage: { setItem: (key, value) => values.set(key, value) },
    banchiSetError: (step, error) => errors.push({ step, error: error.message }),
    closeModal() {}, showToast() {}, updateAddrButton() {}, updateStreetsHousenumButton() {},
    banchiScheduleUpdate() {}, banchiRender() {},
    streetsHousenumLayerVisible() { return context.addrVisible; },
    hyphenBanchiLayerVisible() { return context.addrVisible && context.hyphenBanchiVisible; }
  });
  vm.runInContext(names.map(source).join('\n'), context);
  return { context, layers, values, errors, button };
}

// Evaluate only the filter/label operations used by the real style against fixtures.
function evaluate(expr, properties) {
  if (!Array.isArray(expr)) return expr;
  const [op, ...args] = expr;
  const value = arg => evaluate(arg, properties);
  switch (op) {
    case 'get': return properties[args[0]] ?? null;
    case 'coalesce': return args.map(value).find(item => item !== null && item !== undefined) ?? null;
    case 'to-string': return String(value(args[0]) ?? '');
    case 'to-number': {
      const candidate = value(args[0]);
      return candidate !== '' && Number.isFinite(Number(candidate)) ? Number(candidate) : value(args[1]);
    }
    case 'concat': return args.map(value).join('');
    case 'all': return args.every(value);
    case '==': return value(args[0]) === value(args[1]);
    case '>': return value(args[0]) > value(args[1]);
    case '%': return value(args[0]) % value(args[1]);
    default: throw new Error(`Unexpected expression ${op}`);
  }
}

test('numbered blocks keep digits only; building and town labels are excluded', () => {
  const { context } = createContext();
  const layer = context.blockNumberLayerDefinition();
  for (const name of ['4', '12', '13', '17']) {
    const properties = { type: 'block', name };
    assert.equal(evaluate(layer.filter, properties), true);
    assert.equal(evaluate(layer.layout['text-field'], properties), name);
  }
  assert.equal(evaluate(layer.layout['text-field'], { type: 'block', name: 'fallback', name_ja: '13' }), '13');
  for (const properties of [{ type: 'neighbourhood', name: '13' }, { type: 'building', name: '13' },
    { type: 'block', name: '' }, { type: 'block', name: 'Sample Town' },
    { type: 'block', name: '-1' }, { type: 'block', name: '13.5' }]) {
    assert.equal(evaluate(layer.filter, properties), false);
  }
});

test('block labels reuse the address vector source and use legible styling', () => {
  const { context } = createContext();
  const layer = context.blockNumberLayerDefinition();
  assert.equal(layer.source, 'streets');
  assert.equal(layer['source-layer'], 'place_label');
  assert.equal(layer.paint['text-color'], '#6b1689');
  assert.equal(layer.paint['text-halo-color'], '#ffffff');
  assert.ok(layer.paint['text-halo-width'] >= 2);
  assert.equal(layer.layout['text-allow-overlap'], false);
  assert.equal(layer.layout['text-ignore-placement'], false);
});

test('zoom sizing stays within readable bounds and low zoom hides the overlay', () => {
  const { context } = createContext();
  const layer = context.blockNumberLayerDefinition();
  assert.equal(layer.minzoom, 16.5);
  const [operator, interpolation, input, ...stops] = layer.layout['text-size'];
  assert.equal(operator, 'interpolate');
  assert.equal(interpolation[0], 'linear');
  assert.equal(input[0], 'zoom');
  assert.equal(stops.length % 2, 0);
  let previousZoom = -Infinity;
  let previousSize = 0;
  for (let index = 0; index < stops.length; index += 2) {
    const [zoom, size] = stops.slice(index, index + 2);
    assert.ok(zoom > previousZoom);
    assert.ok(size >= 18 && size <= 28 && size >= previousSize);
    previousZoom = zoom;
    previousSize = size;
  }
  assert.equal(stops[0], layer.minzoom);
  assert.equal(layer.layout['text-letter-spacing'], 0);
});

test('toggle persists only its own setting, updates accessibility, and restores the old display', () => {
  const { context, layers, values, button } = createContext();
  context.addBlockNumberLayer();
  context.toggleBlockNumbers();
  assert.equal(layers.get('block').layout.visibility, 'none');
  assert.equal(values.get('block-setting'), '0');
  assert.equal(button['aria-pressed'], 'false');
  assert.equal(context.hyphenBanchiVisible, true);
  context.toggleBlockNumbers();
  assert.equal(layers.get('block').layout.visibility, 'visible');
  assert.equal(button['aria-pressed'], 'true');
  assert.equal(values.size, 1);
});

test('address OFF also hides block labels, while the hyphen toggle leaves them visible', () => {
  const { context, layers } = createContext();
  layers.set('house', { layout: { visibility: 'visible' } });
  layers.set('hyphen', { layout: { visibility: 'visible' } });
  context.addBlockNumberLayer();
  context.toggleHyphenBanchiLabels();
  assert.equal(layers.get('block').layout.visibility, 'visible');
  assert.equal(layers.get('house').layout.visibility, 'visible');
  context.toggleAddressBlocks();
  assert.equal(layers.get('block').layout.visibility, 'none');
  context.toggleAddressBlocks();
  assert.equal(layers.get('block').layout.visibility, 'visible');
  context.toggleBlockNumbers();
  context.toggleAddressBlocks();
  context.toggleAddressBlocks();
  assert.equal(layers.get('block').layout.visibility, 'none');
});

test('missing sources, repeated initialization, and unsupported slots are handled', () => {
  const unavailable = createContext({ sourceReady: false });
  unavailable.context.addBlockNumberLayer();
  assert.equal(unavailable.layers.size, 0);
  const fallback = createContext({ rejectSlot: true });
  fallback.context.addBlockNumberLayer();
  fallback.context.addBlockNumberLayer();
  assert.equal(fallback.layers.size, 1);
  assert.equal('slot' in fallback.layers.get('block'), false);
  assert.equal(fallback.errors.length, 0);
  const failed = createContext({ rejectLayer: true });
  assert.doesNotThrow(() => failed.context.addBlockNumberLayer());
  assert.equal(failed.errors.length, 1);
});

test('the full inline script parses and the menu/version wiring stays consistent', () => {
  const start = html.indexOf("<script>\n'use strict';") >= 0
    ? html.indexOf("<script>\n'use strict';") : html.indexOf("<script>\r\n'use strict';");
  new vm.Script(html.slice(start + '<script>'.length, html.lastIndexOf('</script>')));
  const version = /const APP_VERSION = '([^']+)'/.exec(html)[1];
  assert.equal(html.split(version).length - 1, 3);
  assert.match(html, /menu-toggle-block-numbers'\)\.addEventListener\('click', toggleBlockNumbers\)/);
  assert.match(source('toggleAddressBlocks'), /BLOCK_NUMBER_LAYER_ID/);
  assert.match(html.slice(html.indexOf('function updateAddrButton('), html.indexOf('function updateStreetsHousenumButton(')), /updateBlockNumberButton\(\)/);
});
