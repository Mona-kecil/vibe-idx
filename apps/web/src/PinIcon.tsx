/** A pushpin, outlined when unpinned and filled by its button's CSS when pinned. */
export function PinIcon() {
  return (
    <svg className="pin-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3h6l-1 6 3 3v1H7v-1l3-3z" />
      <path d="M12 13v8" />
    </svg>
  );
}
