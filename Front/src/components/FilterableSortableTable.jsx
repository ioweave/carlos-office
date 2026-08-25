import { useMemo, useState } from "react";

import "../styles/table.scss";

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

const valueFor = (row, definition) => (
  typeof definition.value === "function" ? definition.value(row) : row?.[definition.key]
);

const compareValues = (left, right, type) => {
  const leftMissing = left === null || left === undefined || left === "";
  const rightMissing = right === null || right === undefined || right === "";
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) return 0;
    return leftMissing ? 1 : -1;
  }

  if (type === "number") return Number(left) - Number(right);
  if (type === "boolean") return Number(Boolean(left)) - Number(Boolean(right));
  if (type === "text") return String(left).localeCompare(String(right), undefined, { sensitivity: "base" });
  return collator.compare(String(left), String(right));
};

const initialFilters = definitions => Object.fromEntries(
  (definitions || []).map(filter => [filter.key, filter.defaultValue ?? ""]),
);

export default function FilterableSortableTable({
  rows = [],
  columns = [],
  filters = [],
  filtering = true,
  sorting = true,
  defaultSort = null,
  rowKey = row => row.id,
  emptyMessage = "No matching rows.",
}) {
  const [filterValues, setFilterValues] = useState(() => initialFilters(filters));
  const [sort, setSort] = useState(defaultSort);

  const visibleRows = useMemo(() => {
    let result = [...rows];

    if (filtering) {
      result = result.filter(row => filters.every(filter => {
        const selected = filterValues[filter.key];
        if (selected === "" || selected === null || selected === undefined || selected === "all") return true;
        if (typeof filter.predicate === "function") return filter.predicate(row, selected);

        const raw = valueFor(row, filter);
        if (filter.type === "search") {
          return String(raw ?? "").toLocaleLowerCase().includes(String(selected).toLocaleLowerCase());
        }
        return String(raw ?? "") === String(selected);
      }));
    }

    if (sorting && sort?.key) {
      const column = columns.find(entry => entry.key === sort.key);
      if (column) {
        result.sort((left, right) => {
          const leftValue = valueFor(left, column);
          const rightValue = valueFor(right, column);
          const leftMissing = leftValue === null || leftValue === undefined || leftValue === "";
          const rightMissing = rightValue === null || rightValue === undefined || rightValue === "";
          if (leftMissing || rightMissing) {
            if (leftMissing && rightMissing) return 0;
            return leftMissing ? 1 : -1;
          }
          const compared = compareValues(leftValue, rightValue, column.sortType || "mixed");
          return sort.direction === "desc" ? -compared : compared;
        });
      }
    }

    return result;
  }, [columns, filterValues, filtering, filters, rows, sort, sorting]);

  const updateSort = column => {
    if (!sorting || column.sortable === false) return;
    setSort(current => {
      if (!current || current.key !== column.key) return { key: column.key, direction: "asc" };
      if (current.direction === "asc") return { key: column.key, direction: "desc" };
      return null;
    });
  };

  const resetFilters = () => setFilterValues(initialFilters(filters));
  const hasFilters = filtering && Object.entries(filterValues).some(([key, value]) => {
    const definition = filters.find(filter => filter.key === key);
    return value !== (definition?.defaultValue ?? "") && value !== "" && value !== "all";
  });

  return (
    <div className="filter-table">
      {filtering && filters.length > 0 && (
        <div className="filter-table__filters">
          {filters.map(filter => (
            <label key={filter.key} className={`filter-table__filter filter-table__filter--${filter.type || "select"}`}>
              <span>{filter.label}</span>
              {filter.type === "search" ? (
                <input
                  type="search"
                  value={filterValues[filter.key] ?? ""}
                  placeholder={filter.placeholder || "Search…"}
                  onChange={event => setFilterValues(current => ({ ...current, [filter.key]: event.target.value }))}
                />
              ) : (
                <select
                  value={filterValues[filter.key] ?? filter.defaultValue ?? "all"}
                  onChange={event => setFilterValues(current => ({ ...current, [filter.key]: event.target.value }))}
                >
                  {(filter.options || []).map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              )}
            </label>
          ))}
          <div className="filter-table__filter-summary">
            <strong>{visibleRows.length}</strong>
            <span>of {rows.length}</span>
            <button type="button" className="button button--quiet" onClick={resetFilters} disabled={!hasFilters}>Reset</button>
          </div>
        </div>
      )}

      <div className="filter-table__scroll">
        <table className="filter-table__table">
          <thead>
            <tr>
              {columns.map(column => {
                const active = sorting && sort?.key === column.key;
                return (
                  <th key={column.key} className={column.className || ""}>
                    {sorting && column.sortable !== false ? (
                      <button type="button" className="filter-table__sort" onClick={() => updateSort(column)}>
                        <span>{column.label}</span>
                        <span className="filter-table__sort-mark" aria-hidden="true">
                          {active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
                        </span>
                      </button>
                    ) : column.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {!visibleRows.length ? (
              <tr><td className="filter-table__empty" colSpan={columns.length}>{emptyMessage}</td></tr>
            ) : visibleRows.map(row => (
              <tr key={rowKey(row)}>
                {columns.map(column => (
                  <td key={column.key} className={column.className || ""}>
                    {typeof column.render === "function" ? column.render(row) : String(valueFor(row, column) ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
