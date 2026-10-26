import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatMeasure } from '../lib/employeeMetrics';
import { useIsMobile } from '../lib/mobileUi';
import AnalyticsVizExpand from './AnalyticsVizExpand';

// echarts arrives with the first chart (see lib/echarts.js); one promise is
// shared so every card on the page waits on the same download.
let echartsLoad = null;
function loadEcharts() {
  if (!echartsLoad) {
    echartsLoad = import('../lib/echarts').then((module) => module.default);
  }
  return echartsLoad;
}

/** Start the download early (a chat is open) so the first chart draws at once. */
export function warmCharts() {
  loadEcharts().catch(() => {
    echartsLoad = null;
  });
}

function useEcharts() {
  const [lib, setLib] = useState(null);
  useEffect(() => {
    let alive = true;
    loadEcharts().then((loaded) => {
      if (alive) setLib(loaded);
    });
    return () => {
      alive = false;
    };
  }, []);
  return lib;
}

const INK = '#1d1d1f';
const MUTED = '#8e8e93';
const LINE_COLORS = ['#1a1a1a', '#B8860B', '#0F766E', '#4F46E5', '#E11D48', '#0891B2', '#F59E0B', '#8e8e93'];
const PIE_COLORS = ['#4F46E5', '#818CF8', '#0F766E', '#F59E0B', '#E11D48', '#0891B2', '#65A30D', '#7C3AED', '#A1A1AA'];

// Axis ticks read as "$250K" / "1.2M"; tooltips keep the exact value.
function axisLabel(value, format) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) < 1000) return formatMeasure(number, format);
  const abs = Math.abs(number);
  const unit = abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  const scaled = abs / unit[0];
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  const body = `${scaled.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, '$1')}${unit[1]}`;
  const sign = number < 0 ? '-' : '';
  return format === 'money' ? `${sign}$${body}` : `${sign}${body}`;
}

function hostNode(ref) {
  const node = ref.current;
  if (!node) return null;
  return typeof node.getNode === 'function' ? node.getNode() : node;
}

function lineOption(chart, { compact, expanded }) {
  // A second axis only when exactly two measures use different units (count vs dollars).
  const dual = chart.series.length === 2 && chart.series[0].format !== chart.series[1].format;
  const bar = chart.type === 'bar';
  const longLabels = bar && chart.categories.some((label) => String(label).length > 9);
  const many = chart.categories.length > 10;
  const tight = compact && !expanded;
  // Pinch/drag zoom inside the plot would swallow the page scroll on a phone;
  // the slider stays, and the inside gesture comes back in the expanded view.
  const dataZoom = many
    ? [...(tight ? [] : [{ type: 'inside' }]), { type: 'slider', height: tight ? 16 : 18, bottom: 8 }]
    : [];
  return {
    color: LINE_COLORS,
    textStyle: { fontFamily: 'Sohne, sans-serif', color: INK },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#fff',
      borderColor: '#e5e5ea',
      textStyle: { color: INK, fontSize: 13 },
      formatter(params) {
        const rows = Array.isArray(params) ? params : [params];
        const title = rows[0]?.axisValueLabel || rows[0]?.name || '';
        const lines = rows.map((item) => {
          const series = chart.series[item.seriesIndex];
          // A null point is a gap (no data for that bucket), not a zero.
          const value = item.value == null ? 'no data' : formatMeasure(item.value, series?.format || 'int');
          return `${item.marker} ${item.seriesName}: ${value}`;
        });
        return [title, ...lines].join('<br/>');
      },
    },
    legend: {
      type: 'scroll',
      top: 0,
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: MUTED, fontSize: 12 },
    },
    grid: {
      left: compact ? 48 : 56,
      right: dual ? (compact ? 50 : 64) : compact ? 12 : 18,
      top: chart.series.length > 4 ? 48 : 36,
      bottom: many ? 64 : longLabels ? 56 : 28,
    },
    dataZoom,
    xAxis: {
      type: 'category',
      data: chart.categories,
      axisLine: { lineStyle: { color: '#e5e5ea' } },
      axisTick: { show: false },
      axisLabel: {
        color: MUTED,
        fontSize: tight ? 10 : 11,
        hideOverlap: true,
        interval: bar && !tight ? 0 : 'auto',
        rotate: longLabels ? 30 : 0,
      },
    },
    yAxis: (dual ? chart.series : chart.series.slice(0, 1)).map((series, index) => ({
      type: 'value',
      // The legend already names each series; on a phone the axis titles only
      // collide with it.
      name: compact ? '' : series.label,
      nameTextStyle: { color: MUTED, fontSize: 11 },
      position: index === 0 ? 'left' : 'right',
      alignTicks: true,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: index === 0, lineStyle: { color: '#f2f2f7' } },
      axisLabel: {
        color: MUTED,
        fontSize: 11,
        formatter: (value) => axisLabel(value, series.format),
      },
    })),
    series: chart.series.map((series) =>
      bar
        ? {
            name: series.label,
            type: 'bar',
            yAxisIndex: dual ? (series.axis === 'right' ? 1 : 0) : 0,
            data: series.values,
            barMaxWidth: 28,
            itemStyle: { borderRadius: [4, 4, 0, 0] },
          }
        : {
            name: series.label,
            type: 'line',
            yAxisIndex: dual ? (series.axis === 'right' ? 1 : 0) : 0,
            data: series.values,
            smooth: false,
            showSymbol: series.values.length < 24,
            symbolSize: 7,
            lineStyle: { width: 2 },
          },
    ),
  };
}

function pieOption(chart, { compact, expanded }) {
  // Slice labels crowd a phone-width pie; the legend carries the names there.
  const tight = compact && !expanded;
  return {
    color: PIE_COLORS,
    textStyle: { fontFamily: 'Sohne, sans-serif', color: INK },
    tooltip: {
      trigger: 'item',
      backgroundColor: '#fff',
      borderColor: '#e5e5ea',
      textStyle: { color: INK, fontSize: 13 },
      formatter(item) {
        const value = formatMeasure(item.value, chart.format);
        return `${item.name}<br/>${value} · ${item.percent}%`;
      },
    },
    legend: {
      type: 'scroll',
      bottom: 0,
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: MUTED, fontSize: 12 },
    },
    series: [
      {
        type: 'pie',
        // Outside labels need room on a phone, so the expanded pie there is
        // smaller than the desktop one.
        radius: ['0%', tight ? '62%' : compact ? '54%' : expanded ? '72%' : '68%'],
        center: ['50%', tight ? '42%' : '46%'],
        avoidLabelOverlap: true,
        label: {
          show: !tight,
          color: INK,
          fontSize: 12,
          formatter: '{b}',
          // Pinned to the container edge so long names wrap instead of clipping.
          ...(compact ? { alignTo: 'edge', edgeDistance: 6, overflow: 'break', width: 84 } : {}),
        },
        labelLine: { show: !tight, ...(compact ? { length: 10, length2: 0, maxSurfaceAngle: 80 } : {}) },
        data: chart.slices.map((slice) => ({ name: slice.name, value: slice.value })),
      },
    ],
  };
}

function ChartPlot({ chart, expanded, compact }) {
  const ref = useRef(null);
  const echarts = useEcharts();

  useEffect(() => {
    const node = hostNode(ref);
    if (!node || !chart || !echarts) return undefined;
    const instance = echarts.init(node);
    const sizing = { compact, expanded };
    instance.setOption(chart.type === 'pie' ? pieOption(chart, sizing) : lineOption(chart, sizing), true);
    const onResize = () => instance.resize();
    requestAnimationFrame(onResize);
    window.addEventListener('resize', onResize);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', onResize);
      instance.dispose();
    };
  }, [chart, expanded, compact, echarts]);

  return <View ref={ref} style={expanded ? styles.plotExpanded : compact ? styles.plotPhone : styles.plot} />;
}

export default function AnalyticsChartCard({ chart }) {
  const compact = useIsMobile();
  if (!chart) return null;

  return (
    <AnalyticsVizExpand
      title={chart.title}
      subtitle={chart.subtitle}
      inlinePlotStyle={compact ? styles.plotPhone : styles.plot}
    >
      {(open, phone) => <ChartPlot chart={chart} expanded={open} compact={phone} />}
    </AnalyticsVizExpand>
  );
}

const styles = StyleSheet.create({
  plot: {
    height: 320,
    width: '100%',
  },
  plotPhone: {
    height: 250,
    width: '100%',
  },
  plotExpanded: {
    flex: 1,
    width: '100%',
    minHeight: 240,
  },
});
