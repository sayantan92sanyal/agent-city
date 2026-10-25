import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const MAX_FILES = 10;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const TEXT_EXTENSIONS =
  /\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|html|css|jsx?|tsx?|mjs|py|rb|go|rs|java|c|h|cpp|sh|sql|toml|ini|log)$/i;
const MB = 1024 * 1024;

// Mirrors the server's limits so problems show up before sending.
function checkFile(file) {
  const type = file.type || '';
  if (IMAGE_TYPES.has(type)) return file.size > 5 * MB ? `"${file.name}" is over 5 MB` : null;
  if (type === 'application/pdf') return file.size > 20 * MB ? `"${file.name}" is over 20 MB` : null;
  if (type.startsWith('text/') || type === 'application/json' || TEXT_EXTENSIONS.test(file.name)) {
    return file.size > MB ? `"${file.name}" is over 1 MB` : null;
  }
  // Anything else (Word, spreadsheets, zips…) is saved for Claude to open.
  return file.size > 25 * MB ? `"${file.name}" is over 25 MB` : null;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// A pasted screenshot arrives as "image.png"; give it a friendlier name.
function displayName(file) {
  return file.name && file.name !== 'image.png' ? file.name : `screenshot-${Date.now()}.png`;
}

/**
 * Message box with attachments, shared by chats, one-off tasks and the
 * Mayor. Files can be added with the paperclip button, pasted (screenshots)
 * or dropped anywhere on the surrounding dialog. Enter sends; Shift+Enter
 * adds a new line.
 *
 * `onSubmit(text, attachments)` should resolve `false` to keep the draft
 * (e.g. the send failed) and anything else to clear it. Each attachment is
 * `{ name, mediaType, data (base64), previewUrl, size }`.
 *
 * `onStop` (opt-in): when given, a Stop button takes the Send button's place.
 */
export function Composer({
  id,
  label,
  submitLabel = 'Send',
  disabled = false,
  placeholder,
  autoFocus,
  onSubmit,
  onStop,
  children,
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const formRef = useRef(null);
  const textRef = useRef(null);
  const pickerRef = useRef(null);

  async function addFiles(list) {
    const incoming = Array.from(list ?? []);
    if (incoming.length === 0) return;
    const problems = [];
    const accepted = [];
    for (const file of incoming) {
      const problem = checkFile(file);
      if (problem) {
        problems.push(problem);
        continue;
      }
      const dataUrl = await readAsDataUrl(file);
      accepted.push({
        name: displayName(file),
        // An unknown type is left for the server to judge by the extension.
        mediaType: file.type || 'application/octet-stream',
        data: dataUrl.slice(dataUrl.indexOf(',') + 1),
        previewUrl: IMAGE_TYPES.has(file.type) ? dataUrl : undefined,
        size: file.size,
      });
    }
    setFiles((current) => {
      const room = MAX_FILES - current.length;
      if (accepted.length > room) problems.push(`Up to ${MAX_FILES} files per message`);
      return [...current, ...accepted.slice(0, Math.max(room, 0))];
    });
    setFileError(problems.length > 0 ? problems.join('. ') : null);
  }

  // Drops anywhere on the enclosing dialog attach files, not just on the box.
  useEffect(() => {
    const zone = formRef.current?.closest('[role="dialog"]') ?? formRef.current;
    if (!zone) return undefined;
    const hasFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const over = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event) => {
      if (!zone.contains(event.relatedTarget)) setDragging(false);
    };
    const drop = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      addFiles(event.dataTransfer.files);
    };
    zone.addEventListener('dragover', over);
    zone.addEventListener('dragleave', leave);
    zone.addEventListener('drop', drop);
    return () => {
      zone.removeEventListener('dragover', over);
      zone.removeEventListener('dragleave', leave);
      zone.removeEventListener('drop', drop);
    };
  }, []);

  // Grow with the text up to the CSS max-height, then scroll.
  useLayoutEffect(() => {
    const box = textRef.current;
    if (!box) return;
    box.style.height = 'auto';
    if (box.scrollHeight) box.style.height = `${box.scrollHeight}px`;
  }, [text]);

  const canSend = !disabled && (text.trim() !== '' || files.length > 0);

  async function submit(event) {
    event?.preventDefault();
    if (!canSend) return;
    const sentText = text.trim();
    const sentFiles = files;
    setText('');
    setFiles([]);
    setFileError(null);
    const result = await onSubmit(sentText, sentFiles);
    if (result === false) {
      // Give the unsent draft back so the user can retry it.
      setText(sentText);
      setFiles(sentFiles);
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      submit(event);
    }
  }

  function handlePaste(event) {
    const pasted = Array.from(event.clipboardData?.files ?? []);
    if (pasted.length > 0) {
      event.preventDefault();
      addFiles(pasted);
    }
  }

  return (
    <form ref={formRef} className={`composer${dragging ? ' composer-dragging' : ''}`} onSubmit={submit}>
      <label htmlFor={id}>{label}</label>
      <div className="composer-box">
        {files.length > 0 && (
          <ul className="composer-files">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`} className="composer-file">
                {file.previewUrl ? (
                  <img src={file.previewUrl} alt="" />
                ) : (
                  <span className="composer-file-icon" aria-hidden="true">📄</span>
                )}
                <span className="composer-file-name" title={file.name}>{file.name}</span>
                <button
                  type="button"
                  className="composer-file-remove"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          id={id}
          ref={textRef}
          rows={1}
          value={text}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <div className="composer-actions">
          <button
            type="button"
            className="composer-attach"
            aria-label="Attach files"
            title="Attach images, PDFs or text files (you can also paste or drop them)"
            onClick={() => pickerRef.current?.click()}
          >
            📎
          </button>
          <input
            ref={pickerRef}
            type="file"
            multiple
            hidden
            data-testid={`${id}-files`}
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <span className="composer-hint">Enter to send · Shift+Enter for a new line</span>
          {children}
          {onStop ? (
            <button type="button" className="composer-stop" onClick={onStop}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!canSend}>
              {submitLabel}
            </button>
          )}
        </div>
      </div>
      {fileError && (
        <p className="form-error composer-error" role="alert">
          {fileError}
        </p>
      )}
      {dragging && <div className="composer-drop-hint">Drop files to attach</div>}
    </form>
  );
}
