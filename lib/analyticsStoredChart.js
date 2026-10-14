// Trims a chart, table, map, or file card down to what is worth keeping in
// storage (saved chats, dashboard caches). Shared by the Analytics chat and the
// Dashboards app so both persist the same shape.

// A year of daily points, matching MAX_LINE_POINTS in lib/analyticsChartTools.
export const MAX_CHART_POINTS = 370;

export function storedChart(chart) {
  if (!chart || typeof chart !== 'object') return null;
  const title = String(chart.title || '').slice(0, 80);
  const subtitle = String(chart.subtitle || '').slice(0, 80);
  if ((chart.type === 'line' || chart.type === 'bar') && Array.isArray(chart.categories) && Array.isArray(chart.series)) {
    return {
      type: chart.type,
      title,
      subtitle,
      categories: chart.categories.slice(0, MAX_CHART_POINTS).map((item) => String(item).slice(0, 24)),
      series: chart.series.slice(0, 8).map((series) => ({
        key: String(series.key || ''),
        label: String(series.label || '').slice(0, 40),
        format: ['money', 'decimal', 'hours'].includes(series.format) ? series.format : 'int',
        axis: series.axis === 'right' ? 'right' : 'left',
        values: (series.values || []).slice(0, MAX_CHART_POINTS).map((value) => Number(value) || 0),
      })),
    };
  }
  if (chart.type === 'pie' && Array.isArray(chart.slices)) {
    return {
      type: 'pie',
      title,
      subtitle,
      format: ['money', 'decimal', 'hours'].includes(chart.format) ? chart.format : 'int',
      slices: chart.slices.slice(0, 12).map((slice) => ({
        name: String(slice.name || '').slice(0, 40),
        value: Number(slice.value) || 0,
      })),
    };
  }
  if (chart.type === 'file' && Array.isArray(chart.sheets)) {
    // Rows are not persisted for sheets that came from a live source; the
    // card rebuilds those from `spec` when Download is pressed after a reload.
    const column = (item) => ({
      key: String(item?.key || '').slice(0, 60),
      label: String(item?.label || item?.key || '').slice(0, 60),
      format: ['int', 'decimal', 'money', 'hours'].includes(item?.format) ? item.format : 'text',
    });
    const sheets = chart.sheets
      .slice(0, 8)
      .map((sheet) => {
        const columns = (Array.isArray(sheet?.columns) ? sheet.columns : []).map(column).filter((item) => item.key);
        if (!columns.length) return null;
        const spec = sheet?.spec && typeof sheet.spec === 'object' ? sheet.spec : null;
        const rows = spec
          ? []
          : (Array.isArray(sheet?.rows) ? sheet.rows : []).slice(0, 200).map((row) =>
              Object.fromEntries(columns.map((item) => [item.key, row?.[item.key] ?? ''])),
            );
        return {
          name: String(sheet?.name || 'Sheet').slice(0, 31),
          columns,
          rows,
          total: Number(sheet?.total) || rows.length,
          scopeLabel: String(sheet?.scopeLabel || '').slice(0, 160),
          spec,
        };
      })
      .filter(Boolean);
    if (!sheets.length) return null;
    return {
      type: 'file',
      kind: 'xlsx',
      title,
      fileName: String(chart.fileName || title).slice(0, 80),
      subtitle,
      note: String(chart.note || '').slice(0, 200) || undefined,
      sheets,
    };
  }
  if (chart.type === 'table' && Array.isArray(chart.columns) && Array.isArray(chart.rows)) {
    const columns = chart.columns
      .slice(0, 8)
      .map((column) => ({
        key: String(column?.key || '').slice(0, 40),
        label: String(column?.label || '').slice(0, 40),
        format: ['int', 'decimal', 'money', 'hours'].includes(column?.format) ? column.format : 'text',
      }))
      .filter((column) => column.key);
    if (!columns.length) return null;
    const cell = (value, format) => {
      if (value == null) return '';
      if (format === 'text') return String(value).slice(0, 80);
      return Number.isFinite(Number(value)) ? Number(value) : String(value).slice(0, 80);
    };
    const pick = (row) =>
      row && typeof row === 'object'
        ? Object.fromEntries(columns.map((column) => [column.key, cell(row[column.key], column.format)]))
        : null;
    const footer = chart.footer && typeof chart.footer === 'object' ? pick(chart.footer) : null;
    return {
      type: 'table',
      title,
      subtitle,
      columns,
      rows: chart.rows.slice(0, 60).map(pick).filter(Boolean),
      footer: footer || undefined,
      note: String(chart.note || '').slice(0, 160) || undefined,
      tickets: (Array.isArray(chart.tickets) ? chart.tickets : [])
        .slice(0, 60)
        .map((ticket) => ({
          reference: String(ticket?.reference || '').slice(0, 24),
          type: ticket?.type === 'purchase' ? 'purchase' : 'order',
          sourceId: String(ticket?.sourceId || '').slice(0, 24),
          systemKey: String(ticket?.systemKey || 'east').slice(0, 16),
        }))
        .filter((ticket) => ticket.sourceId),
    };
  }
  if (chart.type === 'map' && (Array.isArray(chart.markers) || Array.isArray(chart.areas))) {
    // Street lines are not kept in saved chats; the popup falls back to postal code and city.
    return {
      type: 'map',
      style: ['heat', 'area'].includes(chart.style) ? chart.style : 'dots',
      title,
      subtitle,
      city: String(chart.city || '').slice(0, 40),
      note: String(chart.note || '').slice(0, 160),
      areas: (Array.isArray(chart.areas) ? chart.areas : []).slice(0, 5).map((area) => ({
        name: String(area?.name || '').slice(0, 60),
        lat: Number(area?.lat),
        lng: Number(area?.lng),
        approximate: area?.approximate ? true : undefined,
        rings: (Array.isArray(area?.rings) ? area.rings : [])
          .slice(0, 12)
          .map((ring) =>
            (Array.isArray(ring) ? ring : [])
              .slice(0, 400)
              .map((pair) => [Number(pair?.[0]), Number(pair?.[1])])
              .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1])),
          )
          .filter((ring) => ring.length >= 3),
      })),
      missingPostal: Number(chart.missingPostal) || 0,
      unplaced: Number(chart.unplaced) || 0,
      markers: (Array.isArray(chart.markers) ? chart.markers : [])
        .slice(0, 1500)
        .map((marker) => ({
          lat: Number(marker.lat),
          lng: Number(marker.lng),
          label: String(marker.label || '').slice(0, 16),
          city: String(marker.city || '').slice(0, 40),
          count: Number(marker.count) || 0,
          customers: (Array.isArray(marker.customers) ? marker.customers : [])
            .slice(0, 12)
            .map((customer) => ({
              id: String(customer?.id || '').slice(0, 40),
              systemKey: String(customer?.systemKey || '').slice(0, 16),
              name: String(customer?.name || '').slice(0, 60),
              transactions: Number(customer?.transactions) || 0,
            }))
            .filter((customer) => customer.id),
        }))
        .filter((marker) => Number.isFinite(marker.lat) && Number.isFinite(marker.lng)),
    };
  }
  return null;
}
