/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import {
  CollectionBase,
  Node,
  SelectionMode,
  Sortable,
  SortDescriptor,
  SortDirection
} from '@react-types/shared';
import {ColumnProps, TableCollection as ITableCollection} from '@react-types/table';
import {GridNode} from '@react-types/grid';
import {GridState, useGridState} from '@react-stately/grid';
import {Key, useEffect, useMemo, useRef, useState} from 'react';
import {MultipleSelectionStateProps} from '@react-stately/selection';
import {TableCollection} from './TableCollection';
import {useCollection} from '@react-stately/collections';

export interface TableState<T> extends GridState<T, ITableCollection<T>> {
  /** A collection of rows and columns in the table. */
  collection: ITableCollection<T>,
  /** Whether the row selection checkboxes should be displayed. */
  showSelectionCheckboxes: boolean,
  /** The current sorted column and direction. */
  sortDescriptor: SortDescriptor,
  /** Calls the provided onSortChange handler with the provided column key and sort direction. */
  sort(columnKey: Key): void,

  getColumnWidth(key: Key): number
}

export interface CollectionBuilderContext<T> {
  showSelectionCheckboxes: boolean,
  selectionMode: SelectionMode,
  columns: Node<T>[]
}

export interface TableStateProps<T>
  extends CollectionBase<T>,
    MultipleSelectionStateProps,
    Sortable {
  /** Whether the row selection checkboxes should be displayed. */
  showSelectionCheckboxes?: boolean
}

const OPPOSITE_SORT_DIRECTION = {
  ascending: 'descending' as SortDirection,
  descending: 'ascending' as SortDirection
};

/**
 * Provides state management for a table component. Handles building a collection
 * of columns and rows from props. In addition, it tracks row selection and manages sort order changes.
 */
export function useTableState<T extends object>(
  props: TableStateProps<T>
): TableState<T> {
  let context = useMemo(
    () => ({
      showSelectionCheckboxes:
        props.showSelectionCheckboxes && selectionMode !== 'none',
      selectionMode,
      columns: []
    }),
    [props.children, props.showSelectionCheckboxes, selectionMode]
  );

  let collection = useCollection<T, TableCollection<T>>(
    props,
    (nodes, prev) => new TableCollection(nodes, prev, context),
    context
  );

  let {selectionMode = 'none'} = props;

  // map of the columns and their width, key is the column key, value is the width
  // TODO: switch to useControlledState
  const [columnWidths, recalculateColumnWidths] = useColumnResizeWidthState(collection.columns);

  function getColumnWidth(key: Key): number {
    return columnWidths.current.get(key);
  }

  function onColumnResize(column: any, deltaX: number) {
    recalculateColumnWidths(column, deltaX);
  }
  let {disabledKeys, selectionManager} = useGridState({
    ...props,
    collection
  });

  return {
    collection,
    disabledKeys,
    selectionManager,
    showSelectionCheckboxes: props.showSelectionCheckboxes || false,
    sortDescriptor: props.sortDescriptor,
    sort(columnKey: Key) {
      props.onSortChange({
        column: columnKey,
        direction:
          props.sortDescriptor?.column === columnKey
            ? OPPOSITE_SORT_DIRECTION[props.sortDescriptor.direction]
            : 'ascending'
      });
    },
    columnWidths,
    getColumnWidth,
    onColumnResize
  };
}

function useColumnResizeWidthState<T>(columns: GridNode<T>[]) {
  // TODO: switch to the virtualizer width
  const tableWidth = 800;
  const [columnWidths, setColumnWidths] = useState<Map<Key, number>>(buildColumnWidths(columns, tableWidth));
  const columnWidthsRef = useRef<Map<Key, number>>(columnWidths);
  const [resizedColumns, setResizedColumns] = useState<Set<Key>>(new Set());
  const resizedColumnsRef = useRef<Set<Key>>(resizedColumns);

  function setColumnWidthsForRef(newWidths: Map<Key, number>) {
    columnWidthsRef.current = newWidths;
    // new map so that change detection is triggered
    setColumnWidths(newWidths);
  }

  // TODO: evaluate if we need useCallback or not
  const calculateColumnWidths = (column: GridNode<T>, newWidth: number) => {
    // copy the columnWidths map and set the new width for the column being resized
    let widths = new Map<Key, number>(columnWidthsRef.current);
    widths.set(column.key, Math.max(
      getMinWidth(column.minWidth),
      Math.min(newWidth, getMaxWidth(column.maxWidth))
    ));

    // keep track of all columns that have been seized
    resizedColumnsRef.current.add(column.key);
    setResizedColumns(resizedColumnsRef.current);

    // get the columns affected by resize and remaining space
    const resizeIndex = columns.findIndex(col => col.key === column.key);
    let affectedColumns = columns.slice(resizeIndex + 1);
    const availableSpace = columns.slice(0, resizeIndex + 1).reduce((acc, col) => acc - widths.get(col.key), tableWidth);

    // merge the unaffected column widths and the recalculated column widths
    widths = new Map<Key, number>([...widths, ...buildColumnWidths(affectedColumns, availableSpace)]);
    setColumnWidthsForRef(widths);
  };

  function buildColumnWidths(affectedColumns: GridNode<T>[], availableSpace: number): Map<Key, number> {
    const widths = new Map<Key, number>();
    const remainingColumns = new Set<GridNode<T>>();
    let remainingSpace = availableSpace;
    
    // static columns
    for (let column of affectedColumns) {
      let props = column.props as ColumnProps<T>;
      let width = resizedColumns?.has(column.key) ? columnWidthsRef.current.get(column.key) : props.width ?? props.defaultWidth ?? 75;
      if (isStatic(width)) {
        let w = parseWidth(width);
        widths.set(column.key, w);
        remainingSpace -= w;
      } else {
        remainingColumns.add(column);
      }
    }

    // dynamic columns
    if (remainingColumns.size > 0) {
      const newColumnWidths = getDynamicColumnWidths(Array.from(remainingColumns), remainingSpace);
      let i = 0;
      for (let column of newColumnWidths) {
        widths.set(column.key, newColumnWidths[i].columnWidth);
        i++;
      }
    }

    return widths;
  }

  function isStatic(width: number | string): boolean {
    return width !== null && (typeof width === 'number' || width.match(/^(\d+)%$/) !== null);
  }

  function parseWidth(width: number | string): number {
    if (typeof width === 'string') {
      let match = width.match(/^(\d+)%$/);
      if (!match) {
        throw new Error('Only percentages are supported as column widths');
      }
      return tableWidth * (parseInt(match[1], 10) / 100);
    }
    return width;
  }

  function getDynamicColumnWidths(remainingColumns: GridNode<T>[], remainingSpace: number) {
    let columns = mapColumns(remainingColumns, remainingSpace);
  
    columns.sort((a, b) => b.delta - a.delta);
    columns = solveWidths(columns, remainingSpace);
    columns.sort((a, b) => a.index - b.index);
  
    return columns;
  }

  function mapColumns(remainingColumns: GridNode<T>[], remainingSpace: number) {
    let remainingFractions = remainingColumns.reduce(
      (sum, column) => sum + parseFractionalUnit(column.props.defaultWidth),
      0
    );
  
    let columns = [...remainingColumns].map((column, index) => {
      const targetWidth =
        (parseFractionalUnit(column.props.defaultWidth) * remainingSpace) / remainingFractions;
  
      return {
        ...column,
        index,
        delta: Math.max(
          0,
          getMinWidth(column.minWidth) - targetWidth,
          targetWidth - getMaxWidth(column.maxWidth)
        )
      };
    });
  
    return columns;
  }

  function solveWidths(remainingColumns: GridNode<T>[], remainingSpace: number) {
    let remainingFractions = remainingColumns.reduce(
      (sum, col) => sum + parseFractionalUnit(col.props.defaultWidth),
      0
    );
  
    for (let i = 0; i < remainingColumns.length; i++) {
      const column = remainingColumns[i];
  
      const targetWidth =
        (parseFractionalUnit(column.props.defaultWidth) * remainingSpace) / remainingFractions;
  
      let width = Math.max(
        getMinWidth(column.minWidth),
        Math.min(targetWidth, getMaxWidth(column.maxWidth))
      );
      column.columnWidth = width;
      remainingSpace -= width;
      remainingFractions -= parseFractionalUnit(column.props.defaultWidth);
    }
  
    return remainingColumns;
  }

  function parseFractionalUnit(width: string): number {
    if (!width) {
      return 1;
    } 
    return parseInt(width.match(/(?<=^flex-)(\d+)/g)[0], 10);
  }

  function getMinWidth(minWidth: number | string): number {
    return minWidth !== undefined && minWidth !== null
      ? parseWidth(minWidth)
      : 75;
  }
  
  function getMaxWidth(maxWidth: number | string): number {
    return maxWidth !== undefined && maxWidth !== null
      ? parseWidth(maxWidth)
      : Infinity;
  }


  return [columnWidthsRef, calculateColumnWidths];
}

/*
  //fake current table width
  //TableLayout needs to recieve widths from useTableState
  //useTableColumnResizer should call onResize(column, newWidth)
*/
