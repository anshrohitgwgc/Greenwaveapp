import { useEffect } from "react";

export default function Lightbox({ photo, onClose }) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!photo) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="lightbox-backdrop" data-testid="lightbox-backdrop" onClick={handleBackdropClick}>
      <div className="lightbox-modal" data-testid="lightbox-modal">
        <button
          className="lightbox-close"
          data-testid="lightbox-close"
          onClick={onClose}
          aria-label="Close Lightbox"
        >
          &times;
        </button>
        <div className="lightbox-image-container">
          <img
            src={photo.url || photo.thumbnailUrl || "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="}
            alt={photo.filename || "Inventory Photo"}
            className="lightbox-image"
            data-testid="lightbox-image"
          />
        </div>
        <div className="lightbox-metadata" data-testid="lightbox-metadata">
          <h4 className="lightbox-filename">{photo.filename || "Evidence Photo"}</h4>
          <div className="lightbox-meta-grid">
            <div><span className="meta-lbl">Type:</span> <span className="meta-val">{photo.photoType || "inbound"}</span></div>
            <div><span className="meta-lbl">Job Reference:</span> <span className="meta-val">{photo.jobReference || "—"}</span></div>
            <div><span className="meta-lbl">Date:</span> <span className="meta-val">{photo.createdAt ? new Date(photo.createdAt).toLocaleString() : "Just now"}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
