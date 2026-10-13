import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useIsMobile } from '../lib/mobileUi';
import AnalyticsVizExpand from './AnalyticsVizExpand';
import { FONT } from './TriageKit';

const ACCENT = '#1a1a1a';
let mapsPromise = null;
let mapsKeyUsed = '';

function loadMaps(apiKey) {
  if (typeof window === 'undefined') return Promise.reject(new Error('Maps need a browser.'));
  if (window.google?.maps && mapsKeyUsed === apiKey) return Promise.resolve(window.google.maps);
  if (mapsPromise && mapsKeyUsed === apiKey) return mapsPromise;
  mapsKeyUsed = apiKey;
  mapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-cgold-maps]');
    if (existing && window.google?.maps) {
      resolve(window.google.maps);
      return;
    }
    const script = document.createElement('script');
    script.dataset.cgoldMaps = '1';
    script.async = true;
    // No `libraries=visualization`: Google removed HeatmapLayer in 3.65. Heat is drawn by HeatOverlay below.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.onload = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error('Google Maps did not start.'));
    };
    script.onerror = () => reject(new Error('Could not load Google Maps.'));
    document.head.appendChild(script);
  });
  return mapsPromise;
}

function escapeText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function hostNode(ref) {
  const node = ref.current;
  if (!node) return null;
  return typeof node.getNode === 'function' ? node.getNode() : node;
}

function popupHtml(marker) {
  const lines = [
    [marker.address, marker.city].filter(Boolean).map(escapeText).join(', '),
    [marker.label, marker.city && !marker.address ? marker.city : ''].filter(Boolean).map(escapeText).join(' · '),
    `${Number(marker.count) || 0} ${marker.count === 1 ? 'customer' : 'customers'}`,
  ].filter(Boolean);
  return `<div style="font-family:Sohne,sans-serif;font-size:13px;line-height:18px;color:#1d1d1f">${lines.join('<br/>')}</div>`;
}

const POPUP_LINK_STYLE =
  'display:block;width:100%;text-align:left;background:none;border:0;padding:5px 0;margin:0;cursor:pointer;' +
  'font-family:Sohne,sans-serif;font-size:13px;line-height:18px;color:#1a1a1a;text-decoration:underline;text-underline-offset:2px;';

// A DOM node rather than an HTML string so each customer is a real button
// that opens their profile in the app.
function popupNode(marker, openCustomer) {
  const root = document.createElement('div');
  root.innerHTML = popupHtml(marker);
  const customers = Array.isArray(marker.customers) ? marker.customers : [];
  if (!customers.length || typeof openCustomer !== 'function') return root;

  const list = document.createElement('div');
  list.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid rgba(42,38,30,0.12);min-width:180px;';
  for (const customer of customers) {
    const button = document.createElement('button');
    button.type = 'button';
    button.style.cssText = POPUP_LINK_STYLE;
    const visits = Number(customer.transactions) || 0;
    button.textContent = visits > 1 ? `${customer.name} · ${visits} tickets` : customer.name;
    button.setAttribute('aria-label', `Open ${customer.name}'s profile`);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openCustomer({ id: customer.id, systemKey: customer.systemKey, label: customer.name });
    });
    list.appendChild(button);
  }
  const more = (Number(marker.count) || 0) - customers.length;
  if (more > 0) {
    const note = document.createElement('div');
    note.style.cssText = 'font-family:Sohne,sans-serif;font-size:12px;line-height:16px;color:#8e8e93;padding-top:4px;';
    note.textContent = `${more} more at this address`;
    list.appendChild(note);
  }
  root.appendChild(list);
  return root;
}

function drawDots(maps, map, markers, openCustomer) {
  const many = markers.length > 60;
  let open = null;
  markers.forEach((marker) => {
    const pin = new maps.Marker({
      map,
      position: { lat: marker.lat, lng: marker.lng },
      title: `${marker.label}: ${marker.count} ${marker.count === 1 ? 'customer' : 'customers'}`,
      label: many
        ? null
        : { text: String(marker.label || '').slice(0, 7), color: '#fff', fontSize: '10px', fontWeight: '600' },
      icon: {
        path: maps.SymbolPath.CIRCLE,
        scale: many ? 5 + Math.min(6, Math.sqrt(marker.count || 1) * 2) : 12 + Math.min(10, Math.sqrt(marker.count || 1) * 2),
        fillColor: ACCENT,
        fillOpacity: many ? 0.75 : 1,
        strokeColor: '#fff',
        strokeWeight: many ? 1 : 2,
      },
    });
    pin.addListener('click', () => {
      open?.close();
      open = new maps.InfoWindow({ content: popupNode(marker, openCustomer) });
      open.open({ map, anchor: pin });
    });
  });
}

// Transparent → pale gold → gold → ember → deep red, sampled 256 wide.
const HEAT_STOPS = [
  [0.0, 'rgba(184,134,11,0)'],
  [0.18, 'rgba(244,228,180,0.55)'],
  [0.45, 'rgba(184,134,11,0.85)'],
  [0.75, 'rgba(194,65,12,0.95)'],
  [1.0, 'rgba(127,29,29,1)'],
];
let heatRamp = null;

function gradientRamp() {
  if (heatRamp) return heatRamp;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 256, 0);
  for (const [offset, color] of HEAT_STOPS) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 1);
  heatRamp = ctx.getImageData(0, 0, 256, 1).data;
  return heatRamp;
}

function heatRadius(zoom) {
  // ~26px at city zoom; grows as you zoom in so blobs keep covering their blocks.
  return Math.max(14, Math.min(90, 26 * 2 ** ((Number(zoom) || 11) - 11)));
}

/**
 * Canvas heat map as a Google OverlayView. Each point paints a radial alpha
 * blob weighted by its customer count; overlaps add up; the alpha channel is
 * then mapped through the colour ramp. Redrawn by Maps on pan and zoom.
 */
function createHeatOverlay(maps, points) {
  class HeatOverlay extends maps.OverlayView {
    constructor() {
      super();
      this.canvas = document.createElement('canvas');
      this.canvas.style.position = 'absolute';
      this.canvas.style.pointerEvents = 'none';
    }

    onAdd() {
      this.getPanes().overlayLayer.appendChild(this.canvas);
    }

    onRemove() {
      this.canvas.remove();
    }

    draw() {
      const projection = this.getProjection();
      const map = this.getMap();
      const bounds = map?.getBounds?.();
      if (!projection || !map || !bounds) return;
      const div = map.getDiv();
      const width = div.offsetWidth;
      const height = div.offsetHeight;
      if (!width || !height) return;

      const sw = projection.fromLatLngToDivPixel(bounds.getSouthWest());
      const ne = projection.fromLatLngToDivPixel(bounds.getNorthEast());
      const left = Math.min(sw.x, ne.x);
      const top = Math.min(sw.y, ne.y);
      this.canvas.style.left = `${left}px`;
      this.canvas.style.top = `${top}px`;
      this.canvas.width = width;
      this.canvas.height = height;

      const ctx = this.canvas.getContext('2d');
      ctx.clearRect(0, 0, width, height);
      const radius = heatRadius(map.getZoom());
      const maxWeight = Math.max(1, ...points.map((point) => Number(point.count) || 1));

      for (const point of points) {
        const pixel = projection.fromLatLngToDivPixel(new maps.LatLng(point.lat, point.lng));
        const x = pixel.x - left;
        const y = pixel.y - top;
        if (x < -radius || y < -radius || x > width + radius || y > height + radius) continue;
        const weight = Math.max(1, Number(point.count) || 1);
        const alpha = Math.min(1, 0.22 + 0.78 * (weight / maxWeight));
        const blob = ctx.createRadialGradient(x, y, 0, x, y, radius);
        blob.addColorStop(0, `rgba(0,0,0,${alpha})`);
        blob.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = blob;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }

      const image = ctx.getImageData(0, 0, width, height);
      const data = image.data;
      const ramp = gradientRamp();
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (!a) continue;
        const index = a * 4;
        data[i] = ramp[index];
        data[i + 1] = ramp[index + 1];
        data[i + 2] = ramp[index + 2];
        data[i + 3] = Math.min(255, Math.round(ramp[index + 3] * 0.9));
      }
      ctx.putImageData(image, 0, 0);
    }
  }
  return new HeatOverlay();
}

function drawHeat(maps, map, markers, openCustomer) {
  const overlay = createHeatOverlay(maps, markers);
  overlay.setMap(map);
  map.__cgoldHeat = overlay;
  // Faint points under the heat so single customers are still findable.
  markers.forEach((marker) => {
    const pin = new maps.Marker({
      map,
      position: { lat: marker.lat, lng: marker.lng },
      icon: {
        path: maps.SymbolPath.CIRCLE,
        scale: 3,
        fillColor: '#1d1d1f',
        fillOpacity: 0.35,
        strokeWeight: 0,
      },
    });
    pin.addListener('click', () => new maps.InfoWindow({ content: popupNode(marker, openCustomer) }).open({ map, anchor: pin }));
  });
}

const AREA_GOLD = '#B8860B';

function drawAreas(maps, map, areas, bounds) {
  for (const area of areas) {
    for (const ring of area.rings || []) {
      const path = ring.map(([lat, lng]) => ({ lat, lng }));
      path.forEach((point) => bounds.extend(point));
      new maps.Polygon({
        map,
        paths: path,
        strokeColor: AREA_GOLD,
        strokeOpacity: 0.95,
        strokeWeight: 2.5,
        fillColor: AREA_GOLD,
        fillOpacity: 0.12,
        clickable: false,
        ...(area.approximate ? { strokeOpacity: 0.7, fillOpacity: 0.06 } : {}),
      });
    }
    if (Number.isFinite(area.lat) && Number.isFinite(area.lng)) {
      new maps.Marker({
        map,
        position: { lat: area.lat, lng: area.lng },
        clickable: false,
        icon: { path: maps.SymbolPath.CIRCLE, scale: 0, fillOpacity: 0, strokeOpacity: 0 },
        label: { text: String(area.name || '').slice(0, 32), color: '#1a1a1a', fontSize: '13px', fontWeight: '600', fontFamily: 'Sohne, sans-serif' },
      });
    }
  }
}

function MapPlot({ chart, apiKey, onOpenCustomer, expanded, compact }) {
  const ref = useRef(null);
  const [error, setError] = useState('');
  // Latest handler without rebuilding the map when the parent re-renders.
  const openRef = useRef(onOpenCustomer);
  useEffect(() => {
    openRef.current = onOpenCustomer;
  }, [onOpenCustomer]);

  useEffect(() => {
    const node = hostNode(ref);
    const markers = Array.isArray(chart?.markers) ? chart.markers : [];
    const areas = Array.isArray(chart?.areas) ? chart.areas : [];
    if (!node || (!markers.length && !areas.length)) return undefined;
    if (!apiKey) {
      setError('Add a Google Maps browser key in Settings → AI Models.');
      return undefined;
    }
    let map;
    let cancelled = false;
    setError('');
    loadMaps(apiKey)
      .then((maps) => {
        if (cancelled) return;
        const first = markers[0] || areas[0]?.rings?.[0]?.[0] && { lat: areas[0].rings[0][0][0], lng: areas[0].rings[0][0][1] } || { lat: 45.5, lng: -73.6 };
        map = new maps.Map(node, {
          center: { lat: first.lat, lng: first.lng },
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          // Inline, a one-finger drag or plain wheel scrolls the conversation;
          // the map takes every gesture only once it is expanded.
          gestureHandling: expanded ? 'greedy' : 'cooperative',
          zoomControl: expanded || !compact,
          zoomControlOptions: { position: maps.ControlPosition.RIGHT_BOTTOM },
        });
        const bounds = new maps.LatLngBounds();
        markers.forEach((marker) => bounds.extend({ lat: marker.lat, lng: marker.lng }));
        const openCustomer = openRef.current ? (row) => openRef.current?.(row) : null;
        if (areas.length) drawAreas(maps, map, areas, bounds);
        if (markers.length) {
          if (chart.style === 'heat') drawHeat(maps, map, markers, openCustomer);
          else drawDots(maps, map, markers, openCustomer);
        }
        if (markers.length > 1 || areas.length) map.fitBounds(bounds, compact && !expanded ? 28 : 48);
        const onResize = () => maps.event.trigger(map, 'resize');
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
        observer?.observe(node);
        map.__cgoldResize = observer;
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Could not load Google Maps.');
      });
    return () => {
      cancelled = true;
      map?.__cgoldResize?.disconnect();
      map?.__cgoldHeat?.setMap?.(null);
    };
  }, [apiKey, chart, expanded, compact]);

  if (error) return <Text style={styles.error}>{error}</Text>;
  return <View ref={ref} style={expanded ? styles.plotExpanded : compact ? styles.plotPhone : styles.plot} />;
}

export default function AnalyticsMapCard({ chart, apiKey, onOpenCustomer }) {
  const compact = useIsMobile();
  if (!chart) return null;
  const extra = () =>
    chart.missingPostal || chart.unplaced ? (
      <Text style={styles.note}>
        {[
          chart.missingPostal ? `${chart.missingPostal} with no address on file` : '',
          chart.unplaced ? `${chart.unplaced} not placed` : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    ) : null;

  return (
    <AnalyticsVizExpand
      title={chart.title}
      subtitle={[chart.subtitle, chart.note].filter(Boolean).join(' · ')}
      extra={extra}
      inlinePlotStyle={compact ? styles.plotPhone : styles.plot}
    >
      {(open, phone) => (
        <MapPlot chart={chart} apiKey={apiKey} onOpenCustomer={onOpenCustomer} expanded={open} compact={phone} />
      )}
    </AnalyticsVizExpand>
  );
}

const styles = StyleSheet.create({
  note: {
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 16,
    color: '#6e6e73',
    paddingHorizontal: 8,
  },
  error: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: '#b42318',
    paddingHorizontal: 8,
  },
  plot: {
    height: 440,
    width: '100%',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#f2f2f7',
  },
  plotPhone: {
    height: 300,
    width: '100%',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#f2f2f7',
  },
  plotExpanded: {
    flex: 1,
    width: '100%',
    minHeight: 240,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#f2f2f7',
  },
});
