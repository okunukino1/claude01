import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../delivery_map_mapbox/test/index.html', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const names = ['updateRouteLinesUi', 'applyRouteLineVisibility', 'toggleRouteLines',
  'addOptimizedRouteLayer', 'addRouteDirectionArrowLayer', 'addNextSegmentLayer',
  'addFollowingSegmentLayer', 'addFlowWalkLayer', 'validRouteLineGeometry',
  'googleGuidancePath', 'addGoogleGuidanceLine', 'addGoogleGuidanceWalkLine',
  'setOptimizedRouteGeometry', 'setNextSegmentGeometry', 'setFollowingSegmentGeometry',
  'renderCachedGuidanceRoute', 'updateGuidanceBannerUi'];
function source(name) {
  const start = html.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const end = /\n(?:async )?function /.exec(html.slice(start + 1));
  return html.slice(start, end ? start + 1 + end.index : html.length);
}
const layerNames = ['OPTIMIZED_ROUTE_LAYER_ID', 'NEXT_SEGMENT_LAYER_ID', 'NEXT_SEGMENT_ARROW_LAYER_ID',
  'FOLLOWING_SEGMENT_LAYER_ID', 'FOLLOWING_SEGMENT_ARROW_LAYER_ID', 'FLOW_WALK_LAYER_ID'];
const constants = html.split('\n').filter(line => /^const (?:ROUTE_LINES_VISIBLE_KEY|OPTIMIZED_ROUTE_(?:SOURCE|LAYER)_ID|NEXT_SEGMENT_(?:SOURCE|LAYER|ARROW_LAYER)_ID|FOLLOWING_SEGMENT_(?:SOURCE|LAYER|ARROW_LAYER)_ID|FLOW_WALK_(?:SOURCE|LAYER)_ID) =/.test(line)).join('\n');
const geometry = { type: 'LineString', coordinates: [[139, 35], [139.001, 35.001]] };

function fixture({ visible = true, storageFailure = false, mapReady = true, rejectSlot = false } = {}) {
  const layers = new Map(), sources = new Map(), stored = new Map([['guidance-cache', 'preserved-route']]);
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, disabled: false, textContent: '', title: '',
      classList: { toggle() {} }, setAttribute(key, value) { this[key] = value; } });
    return elements.get(id);
  };
  const map = {
    getLayer: id => layers.get(id), getSource: id => sources.get(id),
    addSource(id, options) { sources.set(id, { data: options.data, setData(data) { this.data = data; } }); },
    addLayer(layer) { if (rejectSlot && layer.slot) throw new Error('Unsupported slot'); layers.set(layer.id, structuredClone(layer)); },
    setLayoutProperty(id, key, value) { layers.get(id).layout[key] = value; }
  };
  class Polyline {
    constructor(options) { this.options = options; this.visible = options.visible; }
    setVisible(value) { this.visible = value; }
    setMap() { throw new Error('Visibility changes must not detach overlays or markers'); }
  }
  const deliveries = [{ id: 'one', address: 'fixture 1', lat: 35, lng: 139 }, { id: 'two', address: 'fixture 2', lat: 35.001, lng: 139.001 }];
  const context = vm.createContext({ $, map: mapReady ? map : null, routeLinesVisible: visible,
    googleGuidanceMap: {}, googleGuidanceRouteOverlays: [], googleGuidanceRouteMarkers: [{ id: 'one' }, { id: 'two' }],
    google: { maps: { Polyline, SymbolPath: { FORWARD_CLOSED_ARROW: 'arrow' } } },
    localStorage: { setItem(key, value) { if(storageFailure) throw new Error('Storage unavailable'); stored.set(key, value); } },
    closeModal() {}, showToast() {}, saveGuidanceRouteCache() { throw new Error('Toggle must not replace route cache'); },
    fetch() { throw new Error('Visibility toggle must not make API requests'); },
    deliveries, optimizedRouteOrderedIds: ['two', 'one'], optimizedRouteGeometry: structuredClone(geometry),
    cachedGuidanceRoute: { route: { orangeGeometry: geometry, blueGeometry: geometry } }, temporaryGuidanceTargetId: 'two',
    temporaryGuidanceTarget: () => null, nextOptimizedPendingDelivery: () => deliveries[1],
    guidanceBannerTargetLabel: item => item.address, guidanceRouteDistanceMeters: () => 95, formatKm: () => '95m',
    appMode: 'delivery', workMode: 'delivery', guidanceProvider: 'mapbox', editingItemId: null,
    temporaryGuidanceBusy: false, guidanceRefreshBusy: false, googleGuidanceBusy: false,
    currentGuidanceRouteTargets: () => ({ next: deliveries[1], following: deliveries[0] }),
    cachedGuidanceRouteMatches: () => true, setFlowGuidance() {}, showMapboxGuidanceSurface() {}, updateGuidanceProviderUi() {}
  });
  vm.runInContext(constants + '\n' + names.map(source).join('\n'), context);
  const ids = layerNames.map(name => vm.runInContext(name, context));
  return { context, layers, sources, stored, elements, ids, $ };
}
function addLayers(context) {
  context.addOptimizedRouteLayer();context.addNextSegmentLayer();
  context.addFollowingSegmentLayer();context.addFlowWalkLayer();
}
const routeSnapshot = context => JSON.stringify({ deliveries: context.deliveries, order: context.optimizedRouteOrderedIds,
  geometry: context.optimizedRouteGeometry, cache: context.cachedGuidanceRoute,
  temporaryTarget: context.temporaryGuidanceTargetId, markers: context.googleGuidanceRouteMarkers });

test('hiding and showing only changes line visibility and its own preference', () => {
  const state = fixture();addLayers(state.context);
  state.context.addGoogleGuidanceLine(geometry, '#f97316', 8);
  state.context.addGoogleGuidanceWalkLine(geometry);
  const before = routeSnapshot(state.context);
  state.layers.set('delivery-pin', { layout: { visibility: 'visible' } });
  state.layers.set('flow-stop-circle', { layout: { visibility: 'visible' } });
  state.context.toggleRouteLines();
  for(const id of state.ids) assert.equal(state.layers.get(id).layout.visibility, 'none', id);
  assert.ok(state.context.googleGuidanceRouteOverlays.every(line => line.visible === false));
  assert.equal(state.layers.get('delivery-pin').layout.visibility, 'visible');
  assert.equal(state.layers.get('flow-stop-circle').layout.visibility, 'visible');
  assert.equal(routeSnapshot(state.context), before);
  assert.equal(state.stored.get('guidance-cache'), 'preserved-route');
  assert.equal(state.stored.get('rys-mapbox-test-route-lines-visible-v1'), '0');
  assert.equal(state.$('btn-toggle-route-lines')['aria-pressed'], 'false');
  assert.equal(state.$('temporary-guidance-banner').hidden, false);
  assert.equal(state.$('temporary-guidance-target').textContent, 'fixture 2');
  assert.match(state.$('guidance-banner-mode').textContent, /線は非表示/);
  state.context.toggleRouteLines();
  for(const id of state.ids) assert.equal(state.layers.get(id).layout.visibility, 'visible', id);
  assert.ok(state.context.googleGuidanceRouteOverlays.every(line => line.visible === true));
  assert.equal(routeSnapshot(state.context), before);
  assert.equal(state.stored.size, 2);
});

test('late route calculations and style recreation start hidden, including arrows and Google outlines', async () => {
  const state = fixture();
  const pending = Promise.resolve().then(() => {
    addLayers(state.context);
    state.context.addGoogleGuidanceLine(geometry, '#2563eb', 7);
    state.context.addGoogleGuidanceWalkLine(geometry);
  });
  state.context.toggleRouteLines();await pending;
  for(const id of state.ids) assert.equal(state.layers.get(id).layout.visibility, 'none', id);
  assert.ok(state.context.googleGuidanceRouteOverlays.every(line => line.options.visible === false));
  state.layers.clear();addLayers(state.context);
  for(const id of state.ids) assert.equal(state.layers.get(id).layout.visibility, 'none', id);
  state.context.toggleRouteLines();
  for(const id of state.ids) assert.equal(state.layers.get(id).layout.visibility, 'visible', id);
});

test('cached route restoration and geometry updates obey the hidden setting', async () => {
  const state = fixture({ visible: false });
  const before = routeSnapshot(state.context);
  assert.equal(await state.context.renderCachedGuidanceRoute(), true);
  state.context.addFlowWalkLayer();
  state.context.setNextSegmentGeometry({ ...geometry, coordinates: [[139.002,35.002],[139.003,35.003]] });
  for(const id of state.ids) assert.equal(state.layers.get(id).layout.visibility, 'none', id);
  assert.equal(routeSnapshot(state.context), before);
  assert.equal(state.stored.size, 1);
});

test('hidden preference is restored after startup; absent preference defaults to visible', () => {
  const key = /^const ROUTE_LINES_VISIBLE_KEY = .*;$/m.exec(html)[0];
  const declaration = /^let routeLinesVisible = .*;$/m.exec(html)[0];
  for(const [saved, expected] of [[null,true],['0',false],['1',true]]) {
    const actual = vm.runInNewContext(key+'\n'+declaration+'\nrouteLinesVisible', { localStorage: { getItem: () => saved } });
    assert.equal(actual, expected);
  }
});

test('unavailable map and storage do not prevent in-session visibility changes', () => {
  const state = fixture({ storageFailure: true, mapReady: false });
  assert.doesNotThrow(() => state.context.toggleRouteLines());
  assert.equal(state.context.routeLinesVisible, false);
  assert.equal(state.$('btn-toggle-route-lines')['aria-pressed'], 'false');
  state.context.googleGuidanceRouteOverlays.push({ setVisible() { throw new Error('Detached overlay'); } });
  assert.doesNotThrow(() => state.context.toggleRouteLines());
});

test('older Mapbox slot fallback also starts hidden', () => {
  const state = fixture({ visible: false, rejectSlot: true });addLayers(state.context);
  assert.equal(state.layers.size, 6);
  for(const id of state.ids) assert.equal(state.layers.get(id).layout.visibility, 'none', id);
});

test('normal and temporary guidance retain their target banner when lines are hidden', () => {
  const state = fixture({ visible: false });
  state.context.temporaryGuidanceTarget = () => state.context.deliveries[0];
  state.context.updateGuidanceBannerUi();
  assert.equal(state.$('temporary-guidance-banner').hidden, false);
  assert.equal(state.$('temporary-guidance-target').textContent, 'fixture 1');
  assert.match(state.$('guidance-banner-mode').textContent, /一時案内中.*線は非表示/);
  state.context.googleGuidanceBusy = true;
  state.context.updateGuidanceBannerUi();
  assert.equal(state.$('btn-toggle-route-lines').disabled, false);
  assert.equal(state.$('btn-temporary-guidance-refresh').disabled, true);
});

test('both controls are wired and the full application script and version strings are valid', () => {
  const start=html.indexOf("<script>\n'use strict';");
  assert.ok(start >= 0);
  new vm.Script(html.slice(start+'<script>'.length, html.lastIndexOf('</script>')));
  for(const id of ['btn-toggle-route-lines','menu-toggle-route-lines']) {
    assert.ok(html.includes(`$('${id}').addEventListener('click', toggleRouteLines);`));
  }
  const version = /const APP_VERSION = '([^']+)'/.exec(html)[1];
  assert.equal(html.split(version).length - 1, 3);
});
