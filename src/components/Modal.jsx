import "./Modal.css";

export default function Modal({ open, title, children, onClose }) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-card__title">{title}</h3>
        <div className="modal-card__body">{children}</div>
      </div>
    </div>
  );
}
