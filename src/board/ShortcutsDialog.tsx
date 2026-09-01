import Dialog from '@/components/Dialog';
import { useUiStore } from '@/state/uiStore';

/**
 * Spec section 9, plus the keys the canvas needs to make that table true:
 * `Ctrl+C`, without which `Ctrl+V` has no card to paste, and `C`, which reaches
 * the title-only rendering spec 5.2 gives a card.
 */
const SHORTCUTS: ReadonlyArray<{ keys: string[]; action: string }> = [
  { keys: ['Double-click canvas'], action: 'New card at the cursor' },
  { keys: ['Right-click canvas'], action: 'Pick what to add at the cursor' },
  { keys: ['N'], action: 'New card at the centre of the view' },
  { keys: ['Shift', 'N'], action: 'New note' },
  { keys: ['T'], action: 'New text' },
  { keys: ['S'], action: 'Pick a shape' },
  { keys: ['Ctrl', 'C'], action: 'Copy the selection' },
  { keys: ['Ctrl', 'V'], action: 'Paste an image or a card' },
  { keys: ['Enter'], action: 'Open the editor for the selected node' },
  { keys: ['C'], action: 'Collapse the selected cards to their title' },
  { keys: ['Esc'], action: 'Close the panel, cancel an arrow, clear the selection' },
  { keys: ['Tab'], action: 'Switch between the canvas and the columns' },
  { keys: ['Space', 'drag'], action: 'Pan' },
  { keys: ['Ctrl', 'scroll'], action: 'Zoom at the cursor' },
  { keys: ['Ctrl', '0'], action: 'Zoom to fit' },
  { keys: ['Ctrl', '1'], action: 'Zoom to 100%' },
  { keys: ['Ctrl', 'Z'], action: 'Undo' },
  { keys: ['Ctrl', 'Shift', 'Z'], action: 'Redo' },
  { keys: ['Ctrl', 'D'], action: 'Duplicate the selection' },
  { keys: ['Delete'], action: 'Delete the selection' },
  { keys: ['Ctrl', 'G'], action: 'Group the selection into a frame' },
  { keys: ['Ctrl', 'Shift', 'B'], action: 'Extract the selection to a nested board' },
  { keys: ['Ctrl', 'K'], action: 'Search across all boards' },
  { keys: ['1', '–', '7'], action: 'Apply a temper colour to the selection' },
  { keys: ['?'], action: 'This list' },
];

export default function ShortcutsDialog(): JSX.Element {
  const setDialog = useUiStore((s) => s.setDialog);

  return (
    <Dialog title="Keyboard" width="md" onClose={() => setDialog(null)}>
      <table className="w-full border-collapse text-[14px]">
        <tbody>
          {SHORTCUTS.map((row) => (
            <tr key={row.action} className="border-b border-line last:border-b-0">
              <td className="w-[42%] py-1.5 pr-3 align-top">
                <span className="flex flex-wrap items-center gap-1">
                  {row.keys.map((key, index) =>
                    key === 'drag' || key === 'scroll' || key === '–' || key.includes(' ') ? (
                      <span key={`${row.action}-${index}`} className="text-ink-muted">
                        {key}
                      </span>
                    ) : (
                      <kbd key={`${row.action}-${index}`} className="karta-kbd">
                        {key}
                      </kbd>
                    ),
                  )}
                </span>
              </td>
              <td className="py-1.5 align-top text-ink-muted">{row.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
