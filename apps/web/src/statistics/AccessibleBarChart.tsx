import type { ReactNode } from "react";

export interface BarChartRow {
  readonly key: string;
  readonly label: ReactNode;
  readonly value: number;
  readonly formattedValue?: ReactNode;
}

export function AccessibleBarChart({
  caption,
  dataChart,
  labelHeading,
  rows,
  valueHeading,
}: {
  readonly caption: string;
  readonly dataChart: string;
  readonly labelHeading: string;
  readonly rows: readonly BarChartRow[];
  readonly valueHeading: string;
}) {
  const maximum = Math.max(1, ...rows.map(({ value }) => value));

  return (
    <>
      <div
        aria-hidden="true"
        className="bar-chart"
        data-chart={dataChart}
      >
        {rows.map((row) => (
          <div className="bar-chart-row" key={row.key}>
            <span className="bar-chart-label">{row.label}</span>
            <progress
              aria-hidden="true"
              className="bar-chart-bar"
              max={maximum}
              value={row.value}
            />
            <span>{row.formattedValue ?? row.value}</span>
          </div>
        ))}
      </div>
      <div className="table-scroll">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{labelHeading}</th>
              <th scope="col">{valueHeading}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td>{row.formattedValue ?? row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
