import { type BoardEntry, type BoardRecord, RunBoard } from '@indaba/core';
import type { BoardFileRecord } from '@indaba/engine';
import { printableText } from './printable.js';

/** How many accepted entries `watch --plain` lists (AC-39); older ones are counted, not shown. */
export const BOARD_SECTION_ENTRIES = 50;

const EPOCH = new Date(0);

/** Board text is already one clean line; it is filtered again because whatever the file holds is untrusted. */
function shown(text: string): string {
  return printableText(text).replace(/\s+/g, ' ').trim();
}

function isRecord(record: BoardFileRecord): record is BoardRecord {
  return record.type !== 'unknown';
}

function entryLine(entry: BoardEntry): string {
  return `  #${entry.seq} ${shown(entry.stepId)} ${entry.kind}: ${shown(entry.text)}`;
}

/**
 * The board section of `indaba watch --plain` (spec AC-39): the facts, then the newest accepted entries one per
 * line as `#<seq> <step> <kind>: <text>`, then a line saying how many older ones are not shown. Pure: the records
 * come from `BoardReader.readAll`, and the board is rebuilt from them the way the engine kept it. Empty text for a
 * run with no board file, so the output of an older run is exactly what it was.
 */
export function formatBoardSection(records: readonly BoardFileRecord[]): string {
  if (records.length === 0) {
    return '';
  }
  const known = records.filter(isRecord);
  const board = RunBoard.replay(known, { traceId: '', workflow: '', clock: { now: () => EPOCH } });
  const entries = board.entries();
  const lines = ['Board'];

  const facts = [...board.facts()];
  if (facts.length > 0) {
    lines.push('  Facts:');
    for (const [key, entry] of facts) {
      lines.push(`    ${shown(key)}: ${shown(entry.text)} (${shown(entry.stepId)})`);
    }
  }

  if (entries.length === 0) {
    lines.push('  Nothing has been added to the board.');
  } else {
    const newest = entries.slice(-BOARD_SECTION_ENTRIES);
    lines.push('  Notes between steps:', ...newest.map(entryLine));
    const older = entries.length - newest.length;
    if (older > 0) {
      lines.push(`  ${older} older ${older === 1 ? 'entry is' : 'entries are'} not shown.`);
    }
  }
  if (known.some((r) => r.type === 'truncated')) {
    lines.push('  The board reached its size limit; later notes were not kept.');
  }
  return `${lines.join('\n')}\n`;
}
