/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

jest.mock('@react-aria/live-announcer');
import {announce} from '@react-aria/live-announcer';
import {Cell, Column, Row, TableBody, TableHeader, useTableState} from '@react-stately/table';
import {installPointerEvent} from '@react-spectrum/test-utils';
import React, {useRef} from 'react';
import {render} from '@testing-library/react';
import {
  TableCell,
  TableCheckboxCell,
  TableColumnHeader,
  TableHeaderRow,
  TableRow,
  TableRowGroup,
  TableSelectAllCell
} from '../stories/example-backwards-compat';
import userEvent from '@testing-library/user-event';
import {useTable} from '../src';

let mockAnnounce = announce as jest.MockedFunction<typeof announce>;

let columns = [
  {name: 'Name', uid: 'name'},
  {name: 'Type', uid: 'type'},
  {name: 'Level', uid: 'level'}
];

let rows = [
  {id: 1, name: 'Charizard', type: 'Fire, Flying', level: '67'},
  {id: 2, name: 'Squirtle', type: 'Water', level: '12'},
  {id: 3, name: 'Blastoise', type: 'Water', level: '56'},
  {id: 4, name: 'Venusaur', type: 'Grass, Poison', level: '83'},
  {id: 5, name: 'Pikachu', type: 'Electric', level: '100'}
];
// Differs from the main useTable in regards to onAction vs the newer onRowAction/onCellAction
function Table(props) {
  let {onAction, ...otherProps} = props;
  let state = useTableState({
    ...otherProps,
    showSelectionCheckboxes: otherProps.selectionMode === 'multiple'
  });
  let ref = useRef();
  let bodyRef = useRef();
  let {collection} = state;
  let {gridProps} = useTable({...otherProps, scrollRef: bodyRef}, state, ref);

  return (
    <table {...gridProps} ref={ref} style={{borderCollapse: 'collapse'}}>
      <TableRowGroup type="thead" style={{borderBottom: '2px solid gray', display: 'block'}}>
        {collection.headerRows.map(headerRow => (
          <TableHeaderRow key={headerRow.key} item={headerRow} state={state}>
            {[...headerRow.childNodes].map(column =>
              column.props.isSelectionCell
                ? <TableSelectAllCell key={column.key} column={column} state={state} />
                : <TableColumnHeader key={column.key} column={column} state={state} />
            )}
          </TableHeaderRow>
        ))}
      </TableRowGroup>
      <TableRowGroup ref={bodyRef} type="tbody" style={{display: 'block', overflow: 'auto', maxHeight: '200px'}}>
        {[...collection.body.childNodes].map(row => (
          <TableRow key={row.key} item={row} state={state} onAction={onAction}>
            {[...row.childNodes].map(cell =>
              cell.props.isSelectionCell
                ? <TableCheckboxCell key={cell.key} cell={cell} state={state} />
                : <TableCell key={cell.key} cell={cell} state={state} />
            )}
          </TableRow>
        ))}
      </TableRowGroup>
    </table>
  );
}
// I'd use tree.getByRole(role, {name: text}) here, but it's unbearably slow.
let getCell = (tree, text) => {
  // Find by text, then go up to the element with the cell role.
  let el = tree.getByText(text);
  while (el && !/gridcell|rowheader|columnheader/.test(el.getAttribute('role'))) {
    el = el.parentElement;
  }

  return el;
};

describe('useTable', () => {
  describe('actions on rows', () => {
    installPointerEvent();

    it('calls onAction', () => {
      let onAction = jest.fn();
      let tree = render(
        <Table
          onAction={onAction}
          selectionBehavior="replace"
          aria-label="Table with selection"
          selectionMode="multiple">
          <TableHeader columns={columns}>
            {column => (
              <Column key={column.uid}>
                {column.name}
              </Column>
            )}
          </TableHeader>
          <TableBody items={rows}>
            {item => (
              <Row>
                {columnKey => <Cell>{item[columnKey]}</Cell>}
              </Row>
            )}
          </TableBody>
        </Table>
      );

      // @ts-ignore
      userEvent.click(getCell(tree, 'Squirtle'), {pointerType: 'mouse'});
      expect(mockAnnounce).toHaveBeenLastCalledWith('Squirtle selected.');
      expect(mockAnnounce).toHaveBeenCalledTimes(1);
      expect(onAction).not.toHaveBeenCalled();

      mockAnnounce.mockReset();
      // @ts-ignore
      userEvent.dblClick(getCell(tree, 'Squirtle'), {pointerType: 'mouse'});
      expect(mockAnnounce).not.toHaveBeenCalled();
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith(2);
    });
  });
});
