'use client'

import * as React from 'react'
import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart as RLineChart,
  Pie,
  PieChart as RPieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

/**
 * Categorical palette derived strictly from the brand tokens in
 * `globals.css` — navy, safety orange and steel first, semantic hues after.
 * Never introduce a colour here that isn't already a design token.
 */
export const CHART_COLORS = [
  '#062B5C', // navy-700
  '#FF5A00', // safety-500
  '#2E90FA', // info-500
  '#12B76A', // success-500
  '#F79009', // warning-500
  '#9B9B9B', // steel-400
  '#F04438', // danger-500
  '#3F6FB2', // navy-400
  '#616166', // steel-600
] as const

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false)
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)
    const handler = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener('change', handler)
    return () => query.removeEventListener('change', handler)
  }, [])
  return reduced
}

export interface ChartSeries<T> {
  key: keyof T & string
  label: string
  color?: string
}

interface ChartDataTableProps<T extends Record<string, unknown>> {
  data: T[]
  xKey: keyof T & string
  xLabel: string
  series: ChartSeries<T>[]
  caption: string
}

/** Every chart pairs with this — visually hidden, always present for assistive tech. */
function ChartDataTable<T extends Record<string, unknown>>({
  data,
  xKey,
  xLabel,
  series,
  caption,
}: ChartDataTableProps<T>) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{xLabel}</th>
          {series.map((s) => (
            <th scope="col" key={s.key}>
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, index) => (
          <tr key={index}>
            <th scope="row">{String(row[xKey])}</th>
            {series.map((s) => (
              <td key={s.key}>{String(row[s.key] ?? '')}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export interface LineChartProps<T extends Record<string, unknown>> {
  data: T[]
  xKey: keyof T & string
  xLabel: string
  series: ChartSeries<T>[]
  caption: string
  height?: number
}

export function LineChart<T extends Record<string, unknown>>({
  data,
  xKey,
  xLabel,
  series,
  caption,
  height = 280,
}: LineChartProps<T>) {
  const reduced = usePrefersReducedMotion()
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <RLineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#DCDCDF" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: '#616166' }} stroke="#C4C4C8" />
          <YAxis tick={{ fontSize: 12, fill: '#616166' }} stroke="#C4C4C8" />
          <Tooltip />
          <Legend />
          {series.map((s, index) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color ?? CHART_COLORS[index % CHART_COLORS.length]}
              strokeWidth={2}
              dot={false}
              isAnimationActive={!reduced}
            />
          ))}
        </RLineChart>
      </ResponsiveContainer>
      <ChartDataTable data={data} xKey={xKey} xLabel={xLabel} series={series} caption={caption} />
    </div>
  )
}

export function BarChart<T extends Record<string, unknown>>({
  data,
  xKey,
  xLabel,
  series,
  caption,
  height = 280,
}: LineChartProps<T>) {
  const reduced = usePrefersReducedMotion()
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <RBarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#DCDCDF" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: '#616166' }} stroke="#C4C4C8" />
          <YAxis tick={{ fontSize: 12, fill: '#616166' }} stroke="#C4C4C8" />
          <Tooltip />
          <Legend />
          {series.map((s, index) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color ?? CHART_COLORS[index % CHART_COLORS.length]}
              radius={[2, 2, 0, 0]}
              isAnimationActive={!reduced}
            />
          ))}
        </RBarChart>
      </ResponsiveContainer>
      <ChartDataTable data={data} xKey={xKey} xLabel={xLabel} series={series} caption={caption} />
    </div>
  )
}

export interface DonutChartDatum {
  key: string
  label: string
  value: number
  color?: string
}

export function DonutChart({
  data,
  caption,
  valueLabel,
  height = 240,
}: {
  data: DonutChartDatum[]
  caption: string
  valueLabel: string
  height?: number
}) {
  const reduced = usePrefersReducedMotion()
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <RPieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
            isAnimationActive={!reduced}
          >
            {data.map((entry, index) => (
              <Cell key={entry.key} fill={entry.color ?? CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </RPieChart>
      </ResponsiveContainer>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{valueLabel}</th>
            <th scope="col">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((entry) => (
            <tr key={entry.key}>
              <th scope="row">{entry.label}</th>
              <td>{entry.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
