import { useEffect, useRef } from 'react';
import { speakerLabel } from '../transcriptFormat.js';
import { Markdown } from './Markdown.jsx';
import { FileFrame } from './VisualBlock.jsx';

/** URL for a stored attachment, or the local preview of one still being sent. */
export function attachmentUrl(attachment) {
  return attachment.id ? `/api/attachments/${encodeURIComponent(attachment.id)}` : attachment.previewUrl;
}

export function AttachmentList({ attachments }) {
  return (
    <ul className="attachment-list">
      {attachments.map((attachment, index) => {
        const url = attachmentUrl(attachment);
        const isImage = String(attachment.mediaType).startsWith('image/');
        return (
          <li key={attachment.id ?? index} className={isImage ? 'attachment-image' : 'attachment-file'}>
            {isImage && url ? (
              <a href={url} target="_blank" rel="noreferrer noopener" title={attachment.name}>
                <img src={url} alt={attachment.name} />
              </a>
            ) : (
              <span className="attachment-file-name" title={attachment.name}>
                <span aria-hidden="true">📄 </span>
                {attachment.name}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Tool rows read as a quiet note: "[used Bash, Read]" -> "Used Bash, Read".
function displayText(row) {
  return row.kind === 'tool' ? row.text.replace(/^\[used (.*)\]$/, 'Used $1') : row.text;
}

function FileList({ files, fileUrl }) {
  return (
    <ul className="file-list">
      {files.map((file) => {
        const url = fileUrl(file.path);
        const isImage = String(file.mediaType).startsWith('image/');
        return (
          <li key={file.path} className={isImage ? 'file-image' : 'file-chip'}>
            <a href={url} target="_blank" rel="noreferrer noopener" title={file.name}>
              {isImage ? <img src={url} alt={file.name} /> : file.name}
            </a>
            {file.mediaType === 'text/html' && <FileFrame src={url} name={file.name} />}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A chat transcript in the style of a Claude conversation: the user's turns
 * as bubbles on the right (with any attached files), replies as formatted
 * Markdown, tool use as quiet one-line notes. Keeps scrolled to the newest
 * entry. `streamingText`, when given, is a reply still being written: it
 * renders as one more assistant row (Markdown) before the status line; it
 * never renders visuals, so a half-written one doesn't reload every token.
 * `followMedia` (opt-in) re-scrolls to the newest entry when an image or
 * iframe finishes loading, if the reader was at the bottom.
 */
export function Transcript({
  rows,
  assistantLabel,
  streamingLabel,
  statusText,
  testId,
  streamingText,
  renderVisuals = false,
  fileUrl,
  followMedia = false,
  children,
}) {
  const listRef = useRef(null);
  const endRef = useRef(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [rows.length, statusText, streamingText]);

  useEffect(() => {
    const list = listRef.current;
    if (!followMedia || !list) return undefined;
    const onScroll = () => {
      atBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    };
    // `load` doesn't bubble, so listen in the capture phase.
    const onLoad = (event) => {
      const tag = event.target?.tagName;
      if (atBottomRef.current && (tag === 'IMG' || tag === 'IFRAME')) {
        endRef.current?.scrollIntoView?.({ block: 'end' });
      }
    };
    list.addEventListener('scroll', onScroll);
    list.addEventListener('load', onLoad, true);
    return () => {
      list.removeEventListener('scroll', onScroll);
      list.removeEventListener('load', onLoad, true);
    };
  }, [followMedia]);

  return (
    <ul ref={listRef} className="transcript" data-testid={testId}>
      {rows.map((row, index) => {
        const label = speakerLabel(row.kind, row, assistantLabel);
        if (row.kind === 'files') {
          return fileUrl ? (
            <li key={index} className="transcript-entry transcript-files">
              <FileList files={row.files} fileUrl={fileUrl} />
            </li>
          ) : null;
        }
        const formatted = row.kind === 'assistant' || row.kind === 'bridge';
        return (
          <li key={index} className={`transcript-entry transcript-${row.kind}`}>
            {label && row.kind !== 'user' && row.kind !== 'tool' && (
              <span className="transcript-speaker">{label}</span>
            )}
            {row.attachments?.length > 0 && <AttachmentList attachments={row.attachments} />}
            {formatted ? (
              <Markdown text={row.text} renderVisuals={renderVisuals} />
            ) : (
              row.text && <span className="transcript-text">{displayText(row)}</span>
            )}
          </li>
        );
      })}
      {streamingText && (
        <li className="transcript-entry transcript-assistant transcript-streaming">
          <span className="transcript-speaker">{streamingLabel ?? speakerLabel('assistant', null, assistantLabel)}</span>
          <Markdown text={streamingText} renderVisuals={false} />
        </li>
      )}
      {statusText && <li className="transcript-entry transcript-status">{statusText}</li>}
      {children}
      <li ref={endRef} aria-hidden="true" className="transcript-end" />
    </ul>
  );
}
