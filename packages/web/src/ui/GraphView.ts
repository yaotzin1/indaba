import type { EditorResponse, JsonObject, WorkflowEdit, WorkflowPath, WorkflowProblem } from '@indaba/core';
import { type DragEvent, createElement as h, type ReactElement, useCallback, useMemo, useState } from 'react';
import {
  contextOf,
  fieldPaths,
  headerFields,
  placeProblems,
  roleMembers,
  stepMembers,
} from '../form-model.js';
import {
  type BrickKind,
  buildWorkflowGraph,
  clearFailureEdit,
  connectStepsEdit,
  disconnectDependsOnEdit,
  type FailureBrickKind,
  failureBrickEdit,
  isBrickKind,
  isStepBrickKind,
  type StepBrickKind,
  stepBrickEdit,
} from '../graph-model.js';
import { messages } from '../messages.js';
import { type FieldContext, MemberFields, ProblemList } from './FormView.js';
import { NARROW, useMediaQuery } from './media.js';
import { RunGraph, type RunGraphEditProps } from './RunGraph.js';

const formWords = messages.form;
const graphWords = messages.graph;

const STEP_BRICKS: readonly StepBrickKind[] = ['agent', 'api', 'shell', 'debate'];
const FAILURE_BRICKS: readonly FailureBrickKind[] = ['retry_step', 'escalate', 'fail'];

/** Either a ready list of edits, or a function that computes them from the latest `value` in the edit queue (spec AC-10). */
export type QueuedEdit = readonly WorkflowEdit[] | ((value: JsonObject) => readonly WorkflowEdit[]);

export interface GraphViewProps {
  readonly value: JsonObject;
  readonly info: EditorResponse;
  readonly problems: readonly WorkflowProblem[];
  readonly refusal: string | undefined;
  readonly revision: number;
  readonly onEdit: (edits: QueuedEdit) => void;
  readonly onShowSource: (path: WorkflowPath) => void;
  readonly confirm: (message: string) => boolean;
}

/**
 * The workflow draft as an editable graph (specs/web-app-editing-graph): a palette of step and failure bricks on the
 * left, the deterministic dagre canvas in the middle, and the selected step's connections and schema-driven settings on
 * the right.
 */
export function GraphView(props: GraphViewProps): ReactElement {
  const { value, info, problems, onEdit, onShowSource, confirm } = props;
  const schema = info.schema;
  const context = contextOf(value, info.catalog);
  const header = headerFields(schema, value);
  const roles = roleMembers(schema, value, context);
  const steps = stepMembers(schema, value, context);
  const paths = [
    ...fieldPaths(header),
    ...roles.flatMap((r) => fieldPaths(r.fields)),
    ...steps.flatMap((s) => fieldPaths(s.fields)),
  ];
  const placed = placeProblems(problems, paths);
  const fieldContext: FieldContext = { placed, revision: props.revision, onEdit, onShowSource };

  const narrow = useMediaQuery(NARROW);
  const graph = useMemo(
    () => buildWorkflowGraph(value, problems, narrow ? 'TB' : 'LR'),
    [value, problems, narrow],
  );

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const byId =
    selectedId === undefined
      ? -1
      : steps.findIndex((s, i) => s.name === selectedId && graph.nodes[i]?.draft?.addressable === true);
  const index = byId >= 0 ? byId : Math.min(selectedIndex, Math.max(steps.length - 1, 0));
  const selected = steps[index];
  const selectedNode = graph.nodes[index];
  const selectedAddressable = selectedNode?.draft?.addressable === true && selected !== undefined;

  const selectIndex = useCallback(
    (i: number): void => {
      setSelectedIndex(i);
      const addressable = graph.nodes[i]?.draft?.addressable === true;
      setSelectedId(addressable ? steps[i]?.name : undefined);
    },
    [graph.nodes, steps],
  );

  const selectByNodeId = useCallback(
    (nodeId: string): void => {
      const found = graph.nodes.findIndex((n) => n.id === nodeId);
      if (found >= 0) {
        selectIndex(found);
      }
    },
    [graph.nodes, selectIndex],
  );

  const applyStepBrick = useCallback(
    (kind: StepBrickKind, afterStepId: string | undefined): void => {
      const preview = stepBrickEdit(kind, value, info.catalog, afterStepId);
      setSelectedId(preview.id);
      onEdit((latest) => {
        const next = stepBrickEdit(kind, latest, info.catalog, afterStepId);
        setSelectedId(next.id);
        return [next.edit];
      });
    },
    [value, info.catalog, onEdit],
  );

  const applyFailureBrick = useCallback(
    (kind: FailureBrickKind, targetStepId: string | undefined): void => {
      if (targetStepId === undefined) {
        return;
      }
      onEdit((latest) => {
        const edit = failureBrickEdit(latest, targetStepId, kind);
        return edit === undefined ? [] : [edit];
      });
    },
    [onEdit],
  );

  const onDropBrick = useCallback(
    (kind: BrickKind, targetStepId: string | undefined): void => {
      const fallbackId = selectedAddressable ? selected.name : undefined;
      if (isStepBrickKind(kind)) {
        applyStepBrick(kind, targetStepId ?? fallbackId);
      } else {
        applyFailureBrick(kind, targetStepId ?? fallbackId);
      }
    },
    [selectedAddressable, selected, applyStepBrick, applyFailureBrick],
  );

  const onConnect = useCallback(
    (
      source: string,
      target: string,
      sourceHandle: string | null | undefined,
      targetHandle: string | null | undefined,
    ): void => {
      onEdit((latest) => {
        const edit = connectStepsEdit(latest, source, target, sourceHandle, targetHandle);
        return edit === undefined ? [] : [edit];
      });
    },
    [onEdit],
  );

  const removeById = useCallback(
    (stepId: string): void => {
      const targetIndex = steps.findIndex(
        (s, i) => s.name === stepId && graph.nodes[i]?.draft?.addressable === true,
      );
      if (targetIndex < 0) {
        return;
      }
      if (confirm(formWords.confirmRemove(stepId))) {
        onEdit([{ op: 'removeStep', id: stepId }]);
        if (targetIndex === index) {
          const fallbackIndex =
            targetIndex + 1 < steps.length ? targetIndex + 1 : Math.max(targetIndex - 1, 0);
          selectIndex(fallbackIndex);
        }
      }
    },
    [steps, graph.nodes, confirm, onEdit, index, selectIndex],
  );

  const canMoveUp =
    selectedAddressable && index > 0 && (index === 1 || graph.nodes[index - 2]?.draft?.addressable === true);
  const canMoveDown = selectedAddressable && graph.nodes[index + 1]?.draft?.addressable === true;

  const move = (by: -1 | 1): void => {
    if (!selectedAddressable) {
      return;
    }
    const stepId = selected.name;
    onEdit((latest) => {
      const latestNodes = buildWorkflowGraph(latest, [], 'LR').nodes;
      const cur = latestNodes.findIndex((n) => n.draft?.addressable === true && n.id === stepId);
      if (cur < 0) {
        return [];
      }
      if (by === -1) {
        if (cur === 0) {
          return [];
        }
        if (cur === 1) {
          return [{ op: 'moveStep', id: stepId }];
        }
        const before = latestNodes[cur - 2];
        return before?.draft?.addressable === true ? [{ op: 'moveStep', id: stepId, after: before.id }] : [];
      }
      const next = latestNodes[cur + 1];
      return next?.draft?.addressable === true ? [{ op: 'moveStep', id: stepId, after: next.id }] : [];
    });
  };

  const disconnectDep = (stepId: string, fromId: string): void => {
    onEdit((latest) => {
      const edit = disconnectDependsOnEdit(latest, stepId, fromId);
      return edit === undefined ? [] : [edit];
    });
  };

  const clearFailure = (stepId: string): void => {
    onEdit((latest) => {
      const edit = clearFailureEdit(latest, stepId);
      return edit === undefined ? [] : [edit];
    });
  };

  const editProps: RunGraphEditProps = useMemo(
    () => ({
      onConnect,
      onDropBrick,
      onDeleteStep: removeById,
    }),
    [onConnect, onDropBrick, removeById],
  );

  const selectedDepsField = selected?.fields.find((f) => f.key === 'depends_on')?.value;
  const selectedDeps = Array.isArray(selectedDepsField)
    ? selectedDepsField.filter((v): v is string => typeof v === 'string' && v !== '')
    : [];
  const missingDepsSet = new Set(selectedNode?.draft?.missingDependsOn ?? []);
  const selectedFailure = selectedNode?.onFailure;
  const hasFailureField = selected?.fields.find((f) => f.key === 'on_failure')?.value !== undefined;

  return h(
    'div',
    { className: 'graph-editor' },
    props.refusal === undefined
      ? null
      : h('p', { className: 'save-status fail', role: 'alert' }, formWords.refused(props.refusal)),
    h(ProblemList, { title: formWords.problemsTop, problems: placed.top }),
    h(
      'div',
      { className: 'graph-studio' },
      h(
        'aside',
        { className: 'panel palette', 'aria-label': graphWords.paletteLabel },
        h('h3', { className: 'palette-title' }, graphWords.paletteTitle),
        h('p', { className: 'palette-lead muted small' }, graphWords.paletteLead),
        h('h4', { className: 'palette-group' }, graphWords.stepsHeading),
        ...STEP_BRICKS.map((kind) => {
          const text = graphWords.bricks[kind];
          return h(
            'button',
            {
              key: kind,
              type: 'button',
              className: 'brick',
              draggable: true,
              onClick: () => applyStepBrick(kind, selectedAddressable ? selected.name : undefined),
              onDragStart: (event: DragEvent<HTMLButtonElement>) => {
                event.dataTransfer.setData('text/plain', kind);
                event.dataTransfer.effectAllowed = 'copy';
              },
            },
            h('span', { className: 'brick-title' }, text.title),
            h('span', { className: 'brick-detail muted small' }, text.detail),
          );
        }),
        h('h4', { className: 'palette-group' }, graphWords.failureHeading),
        ...FAILURE_BRICKS.map((kind) => {
          const text = graphWords.bricks[kind];
          return h(
            'button',
            {
              key: kind,
              type: 'button',
              className: 'brick',
              draggable: selectedAddressable,
              disabled: !selectedAddressable,
              onClick: () => applyFailureBrick(kind, selectedAddressable ? selected.name : undefined),
              onDragStart: (event: DragEvent<HTMLButtonElement>) => {
                event.dataTransfer.setData('text/plain', kind);
                event.dataTransfer.effectAllowed = 'copy';
              },
            },
            h('span', { className: 'brick-title' }, text.title),
            h('span', { className: 'brick-detail muted small' }, text.detail),
          );
        }),
      ),
      h(
        'section',
        { className: 'panel graph-panel', 'aria-labelledby': 'graph-canvas-title' },
        h(
          'div',
          { className: 'panel-head' },
          h('h3', { id: 'graph-canvas-title' }, graphWords.canvasTitle),
          h(
            'span',
            { className: 'legend muted small' },
            `──▸ ${messages.run.legendWaits} · ╌╌▸ ${messages.run.legendFailure}`,
          ),
        ),
        steps.length === 0
          ? null
          : h(
              'nav',
              { 'aria-label': formWords.stepListLabel },
              h(
                'ol',
                { className: 'step-list' },
                ...steps.map((step, i) => {
                  const draft = graph.nodes[i]?.draft;
                  return h(
                    'li',
                    { key: i },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: i === index ? 'step-pick selected' : 'step-pick',
                        'aria-current': i === index ? 'step' : undefined,
                        onClick: () => selectIndex(i),
                      },
                      step.name === '' ? formWords.stepLabel('') : step.name,
                      draft?.hasProblems
                        ? h('span', { className: 'step-flag' }, ` (${formWords.stepHasProblems})`)
                        : null,
                    ),
                  );
                }),
              ),
            ),
        steps.length === 0
          ? h(
              'div',
              {
                className: 'graph-canvas graph-empty',
                role: 'group',
                'aria-label': graphWords.canvasLabel,
                onDragOver: (event: DragEvent<HTMLDivElement>) => {
                  event.preventDefault();
                },
                onDrop: (event: DragEvent<HTMLDivElement>) => {
                  event.preventDefault();
                  const raw = event.dataTransfer.getData('text/plain');
                  if (isBrickKind(raw)) {
                    onDropBrick(raw, undefined);
                  }
                },
              },
              h('p', { className: 'muted' }, graphWords.emptyCanvas),
            )
          : h(RunGraph, {
              graph,
              selected: selectedNode?.id,
              now: 0,
              onSelect: selectByNodeId,
              edit: editProps,
            }),
        h('p', { className: 'muted small' }, graphWords.canvasHelp),
      ),
      h(
        'aside',
        { className: 'panel step-settings', 'aria-label': graphWords.settingsLabel },
        selected === undefined
          ? h('p', { className: 'muted' }, graphWords.noStepSelected)
          : h(
              'fieldset',
              { className: 'group step', key: `graph-step-${index}` },
              h('legend', null, formWords.stepLabel(selected.name)),
              selectedAddressable
                ? h(
                    'div',
                    { className: 'step-actions' },
                    h(
                      'button',
                      { type: 'button', disabled: !canMoveUp, onClick: () => move(-1) },
                      formWords.moveUp,
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        disabled: !canMoveDown,
                        onClick: () => move(1),
                      },
                      formWords.moveDown,
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'danger',
                        onClick: () => removeById(selected.name),
                        'aria-label': formWords.removeStepLabel(selected.name),
                      },
                      formWords.removeStep,
                    ),
                  )
                : h('p', { className: 'muted small' }, formWords.noIdActions),
              h(
                'div',
                { className: 'connections' },
                h('h4', { className: 'connections-title' }, graphWords.connectionsHeading),
                selectedDeps.length === 0
                  ? h('p', { className: 'muted small' }, graphWords.waitsForNone)
                  : h(
                      'ul',
                      { className: 'connection-list' },
                      ...selectedDeps.map((depId) =>
                        h(
                          'li',
                          { key: depId, className: 'connection-row' },
                          h(
                            'span',
                            { className: missingDepsSet.has(depId) ? 'fail' : undefined },
                            graphWords.waitsForItem(depId, missingDepsSet.has(depId)),
                          ),
                          selectedAddressable
                            ? h(
                                'button',
                                {
                                  type: 'button',
                                  onClick: () => disconnectDep(selected.name, depId),
                                  'aria-label': graphWords.disconnectLabel(depId, selected.name),
                                },
                                graphWords.disconnect,
                              )
                            : null,
                        ),
                      ),
                    ),
                selectedFailure !== undefined || hasFailureField
                  ? h(
                      'div',
                      { className: 'connection-row' },
                      h(
                        'span',
                        {
                          className:
                            selectedNode?.draft?.missingFailureTarget !== undefined ? 'fail' : undefined,
                        },
                        selectedFailure !== undefined
                          ? graphWords.failureRoute(
                              selectedFailure.action,
                              selectedFailure.target,
                              selectedNode?.draft?.missingFailureTarget !== undefined,
                              selectedFailure.maxRetries,
                            )
                          : formWords.labels.on_failure,
                      ),
                      selectedAddressable
                        ? h(
                            'button',
                            {
                              type: 'button',
                              onClick: () => clearFailure(selected.name),
                              'aria-label': graphWords.clearFailureLabel(selected.name),
                            },
                            graphWords.clearFailure,
                          )
                        : null,
                    )
                  : null,
              ),
              h(ProblemList, { title: formWords.problemsHere, problems: placed.byStep.get(index) ?? [] }),
              h(MemberFields, { member: selected, context: fieldContext }),
            ),
      ),
    ),
  );
}
