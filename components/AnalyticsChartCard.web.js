import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, DataZoomComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { formatMeasure } from '../lib/employeeMetrics';
import { CANVAS, NAV_TAB_ACTIVE_RADIUS } from '../lib/mobileUi';
import { FONT } from './TriageKit';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

const INK = '#1d1d1f';
const MUTED = '#8e8e93';
const LINE_COLORS = ['#1a1a1a', '#B8860B', '#0F766E', '#4F46E5', '#E11D48', '#0891B2', '#F59E0B', '#8e8e93'];
const PIE_COLORS = ['#4F46E5', '#818CF8', '#0F766E', '#F59E0B', '#E11D48', '#0891B2', '#65A30D', '#7C3AED', '#A1A1AA'];

function hostNode(ref) {
  const node = ref.current;
  if (!node) return null;
  return typeof node.getNode === 'function' ? node.getNode() : node;
}

function lineOption(chart) {
  // A second axis only when exactly two measures use different units (count vs dollars).
  const dual = chart.series.length === 2 && chart.series[0].format !== chart.series[1].format;
  const bar = chart.type === 'bar';
  const longLabels = bar && chart.categories.some((label) => String(label).length > 9);
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
          const value = formatMeasure(item.value, series?.format || 'int');
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
      left: 56,
      right: dual ? 64 : 18,
      top: chart.series.length > 4 ? 48 : 36,
      bottom: chart.categories.length > 10 ? 64 : longLabels ? 56 : 28,
    },
    dataZoom: chart.categories.length > 10 ? [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8 }] : [],
    xAxis: {
      type: 'category',
      data: chart.categories,
      axisLine: { lineStyle: { color: '#e5e5ea' } },
      axisTick: { show: false },
      axisLabel: {
        color: MUTED,
        fontSize: 11,
        hideOverlap: true,
        interval: bar ? 0 : 'auto',
        rotate: longLabels ? 30 : 0,
      },
    },
    yAxis: (dual ? chart.series : chart.series.slice(0, 1)).map((series, index) => ({
      type: 'value',
      name: series.label,
      nameTextStyle: { color: MUTED, fontSize: 11 },
      position: index === 0 ? 'left' : 'right',
      alignTicks: true,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: index === 0, lineStyle: { color: '#f2f2f7' } },
      axisLabel: {
        color: MUTED,
        fontSize: 11,
        formatter: (value) => formatMeasure(value, series.format),
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

function pieOption(chart) {
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
        radius: ['0%', '68%'],
        center: ['50%', '46%'],
        avoidLabelOverlap: true,
        label: { color: INK, fontSize: 12, formatter: '{b}' },
        data: chart.slices.map((slice) => ({ name: slice.name, value: slice.value })),
      },
    ],
  };
}

export default function AnalyticsChartCard({ chart }) {
  const ref = useRef(null);

  useEffect(() => {
    const node = hostNode(ref);
    if (!node || !chart) return undefined;
    const instance = echarts.init(node);
    instance.setOption(chart.type === 'pie' ? pieOption(chart) : lineOption(chart), true);
    const onResize = () => instance.resize();
    window.addEventListener('resize', onResize);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', onResize);
      instance.dispose();
    };
  }, [chart]);

  if (!chart) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{chart.title}</Text>
      {chart.subtitle ? <Text style={styles.subtitle}>{chart.subtitle}</Text> : null}
      <View ref={ref} style={styles.plot} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    marginTop: 8,
    paddingTop: 12,
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    backgroundColor: CANVAS,
  },
  title: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '500',
    color: '#1a1a1a',
    paddingHorizontal: 8,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 16,
    color: '#6e6e73',
    paddingHorizontal: 8,
    marginBottom: 4,
  },
  plot: {
    height: 320,
    width: '100%',
  },
});
