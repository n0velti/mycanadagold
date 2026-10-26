/**
 * The parts of echarts the app draws with, registered once.
 *
 * Only `components/AnalyticsChartCard.web.js` uses this, through `import()`,
 * so the library (with zrender, the largest third-party code in the app)
 * is fetched the first time a chart is drawn rather than on every page load.
 */
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

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

export default echarts;
