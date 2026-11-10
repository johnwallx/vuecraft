import { useEffect, useState } from 'react';
import { api, type DocNode, type Op, type Resource } from '../bridge/api';
import { chooseFile } from '../bridge/files';
import { isSafeUrl } from '../editors/richText';
import { useEditor } from '../state/editor';

const IMAGE_FILTER = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }];

/** Links, file references and the embedded image of one concept. Opening works on locked layers too. */
export function Attachments({ node, locked }: { node: DocNode; locked: boolean }) {
  const { commit, ask, notify } = useEditor();
  const resources = node.resources ?? [];
  const [status, setStatus] = useState<(boolean | null)[]>([]);
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const key = JSON.stringify(resources);

  useEffect(() => {
    let live = true;
    api.resourceStatus(node.id).then(
      (s) => live && setStatus(s),
      () => live && setStatus([]),
    );
    return () => {
      live = false;
    };
  }, [node.id, key]);

  const setResources = (label: string, next: Resource[]) =>
    void commit(label, [{ op: 'setNodeResources', id: node.id, resources: next }]);

  const addLink = () => {
    const target = draft.trim();
    if (!isSafeUrl(target)) return setInvalid(true);
    setResources('Add link', [...resources, { kind: 'url', target }]);
    setDraft('');
  };

  const attachFile = async () => {
    const path = await chooseFile('Attach File');
    if (path) setResources('Attach file', [...resources, { kind: 'file', target: path }]);
  };

  const open = async (i: number) => {
    const r = resources[i];
    const url = r.kind === 'url';
    const choice = await ask({
      title: url ? 'Open link?' : 'Show file?',
      body: url ? `Open ${r.target} in your web browser?` : `Show ${r.target} in its folder? The file itself is not opened.`,
      choices: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'open', label: url ? 'Open Link' : 'Show in Folder', primary: true },
      ],
      cancel: 'cancel',
    });
    if (choice === 'open') api.openResource(node.id, i).catch((e) => notify(String(e)));
  };

  const insertImage = async () => {
    const path = await chooseFile('Insert Image', IMAGE_FILTER);
    if (!path) return;
    let image: string;
    try {
      image = await api.importImage(path);
    } catch (e) {
      return notify(String(e));
    }
    const ops: Op[] = [{ op: 'setNodeImage', id: node.id, image }];
    // Make room for the picture in a default-sized node.
    if (node.height < 120) ops.push({ op: 'resizeNode', id: node.id, x: node.x, y: node.y, width: Math.max(node.width, 160), height: 140 });
    void commit('Insert image', ops);
  };

  return (
    <section aria-label="Attachments">
      <h2>Attachments</h2>
      {resources.length > 0 && (
        <ul className="attachments">
          {resources.map((r, i) => (
            <li key={i}>
              <span className="attachment-target" title={r.target}>
                {r.title || r.target}
              </span>
              {status[i] === false && <span className="notice inline">File not found</span>}
              <span className="attachment-actions">
                <button type="button" onClick={() => void open(i)} aria-label={`${r.kind === 'url' ? 'Open' : 'Show'} ${r.target}`}>
                  {r.kind === 'url' ? 'Open' : 'Show'}
                </button>
                <button
                  type="button"
                  disabled={locked}
                  aria-label={`Remove ${r.target}`}
                  onClick={() => setResources('Remove attachment', resources.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <fieldset className="plain" disabled={locked}>
        <form
          className="add-link"
          onSubmit={(e) => {
            e.preventDefault();
            addLink();
          }}
        >
          <input
            aria-label="Attachment address"
            aria-invalid={invalid}
            placeholder="https://…"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setInvalid(false);
            }}
          />
          <button type="submit">Add Link</button>
        </form>
        {invalid && <p className="notice">Links must start with http://, https:// or mailto:.</p>}
        <div className="row">
          <button type="button" onClick={() => void attachFile()}>
            Attach File…
          </button>
          {node.image ? (
            <button type="button" onClick={() => void commit('Remove image', [{ op: 'setNodeImage', id: node.id, image: null }])}>
              Remove Image
            </button>
          ) : (
            <button type="button" onClick={() => void insertImage()}>
              Insert Image…
            </button>
          )}
        </div>
      </fieldset>
    </section>
  );
}
